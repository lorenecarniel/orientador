import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const openAiKey = Deno.env.get("OPENAI_API_KEY")!;
const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Answers = Record<string, string | number | boolean | null>;
const allowedKeys = new Set([
  "side", "onset", "trauma", "weight", "startMode", "intensity", "swelling",
  "heat", "fever", "movement", "walk", "lock", "evolution", "activity", "notes",
]);

function urgentFlags(a: Answers): string[] {
  const flags: string[] = [];
  if ((a.trauma === "Sim" || a.trauma === "Não tenho certeza") && a.weight === "Não consigo apoiar")
    flags.push("Dor após queda, batida ou torção com incapacidade de apoiar o peso.");
  if (a.heat === "Sim" && a.fever === "Sim")
    flags.push("Calor ou vermelhidão no joelho junto com febre.");
  if (a.walk === "Não consigo caminhar")
    flags.push("Incapacidade relatada de caminhar.");
  return flags;
}

function answerSummary(a: Answers): string {
  const labels: Record<string, string> = {
    side: "Lado", onset: "Início", trauma: "Queda/batida/torção", weight: "Apoio do peso",
    startMode: "Forma de início", intensity: "Intensidade (0–10)", swelling: "Inchaço",
    heat: "Calor/vermelhidão", fever: "Febre", movement: "Dor ao movimentar",
    walk: "Caminhada", lock: "Travamento/falseio", evolution: "Evolução",
    activity: "Atividade física", notes: "Observação adicional",
  };
  return Object.entries(a)
    .filter(([key, value]) => allowedKeys.has(key) && value !== null && value !== undefined && String(value).trim() !== "")
    .map(([key, value]) => `${labels[key] || key}: ${String(value).slice(0, key === "notes" ? 700 : 120)}`)
    .join("\n");
}

async function createEmbedding(input: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: "Bearer " + openAiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: input.slice(0, 6000) }),
  });
  if (!response.ok) throw new Error("Não foi possível preparar a busca na biblioteca.");
  const payload = await response.json();
  const vector = payload.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== 1536) throw new Error("Dimensão de embedding incompatível com a biblioteca.");
  return vector;
}

 Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  let claimedQuestionnaireId: string | null = null;
  try {
    if (!openAiKey) return json({ error: "A integração de IA ainda não está configurada." }, 503);
    const body = await req.json();
    const questionnaireId = String(body.questionnaire_id || "");
    if (!UUID_RE.test(questionnaireId)) return json({ error: "Identificador do questionário inválido. Reinicie o questionário e tente novamente." }, 400);
    if (body.website) return json({ ok: true });
    const raw = body.answers;
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || JSON.stringify(raw).length > 10000)
      return json({ error: "Respostas inválidas." }, 400);
    const answers: Answers = {};
    for (const [key, value] of Object.entries(raw)) {
      if (allowedKeys.has(key) && ["string", "number", "boolean"].includes(typeof value))
        answers[key] = typeof value === "string" ? value.trim().slice(0, key === "notes" ? 700 : 120) : value as string | number | boolean;
    }
    if (!Object.keys(answers).length) return json({ error: "Não encontramos respostas para analisar." }, 400);
    if (!answers.side || (!answers.intensity && answers.intensity !== 0))
      return json({ error: "Complete o questionário antes de gerar o relatório." }, 400);

    // Reserva atômica: a chave primária impede duas gerações para o mesmo questionário.
    const { error: claimError } = await db
      .from("pain_report_generations")
      .insert({ questionnaire_id: questionnaireId });
    if (claimError) {
      if (claimError.code === "23505") {
        return json({ error: "Este questionário já utilizou sua geração de relatório. Cada questionário permite apenas um relatório." }, 409);
      }
      console.error("pain_report_generations insert:", claimError);
      return json({ error: "Não foi possível validar a geração deste relatório." }, 500);
    }
    claimedQuestionnaireId = questionnaireId;

    const flags = urgentFlags(answers);
    if (flags.length) {
      return json({
        ok: true,
        urgent: true,
        urgent_flags: flags,
        report: {
          summary: "Suas respostas indicam sinais que precisam de avaliação presencial prioritária.",
          possibilities: [],
          educational: "Não é adequado gerar uma explicação automatizada antes de uma avaliação presencial. Procure um serviço de saúde com prioridade. Se houver piora importante ou situação de emergência, procure atendimento de urgência.",
          next_steps: ["Procure avaliação presencial agora.", "Não use este relatório para decidir se deve adiar atendimento."],
        },
        sources: [],
      });
    }

    const summary = answerSummary(answers);
    const embedding = await createEmbedding("Orientação educativa sobre dor no joelho com base neste relato:\n" + summary);
    const { data: matches, error: searchError } = await db.rpc("match_knowledge_chunks", {
      query_embedding: "[" + embedding.join(",") + "]",
      match_count: 6,
      filter_category: null,
    });
    if (searchError) {
      console.error("match_knowledge_chunks:", searchError);
      throw new Error("Não foi possível consultar a biblioteca de conhecimento.");
    }

    const relevant = (matches || []).filter((item: any) =>
      Number(item.similarity) >= 0.2 && String(item.chunk_content || "").trim().length > 0
    );
    const sources = Array.from(new Map(relevant.map((item: any) => [item.source_id, {
      source_id: item.source_id,
      title: item.title || "Material educativo",
      category: item.category || "",
      source_type: item.source_type || "",
      author: item.author || "",
      institution: item.institution || "",
      publication_year: item.publication_year || null,
      source_url: item.source_url || "",
    }])).values());

    if (!relevant.length) {
      return json({
        ok: true, urgent: false, report: {
          summary: "Recebemos suas respostas, mas ainda não encontramos conteúdo suficientemente relacionado na biblioteca científica para montar uma explicação personalizada.",
          possibilities: [],
          educational: "Não vamos preencher essa lacuna com referências genéricas ou não verificadas. Você pode conversar com um profissional habilitado para interpretar seu relato.",
          next_steps: ["Leve estas respostas a um profissional de saúde.", "A biblioteca poderá oferecer uma explicação mais completa quando houver materiais relevantes aprovados."],
        }, sources: [],
      });
    }

    const evidence = relevant.map((item: any, index: number) => ({
      ref: "S" + (index + 1),
      title: item.title,
      category: item.category,
      author: item.author,
      institution: item.institution,
      year: item.publication_year,
      similarity: Number(item.similarity).toFixed(3),
      excerpt: String(item.chunk_content).slice(0, 2600),
      source_id: item.source_id,
    }));
    const prompt = `Responda em português brasileiro, em JSON válido, com as chaves summary (string), possibilities (array de strings), educational (string), next_steps (array de strings) e source_refs (array de strings).
Você é um assistente de educação em saúde musculoesquelética. Produza informação educativa, acolhedora e prudente a partir do relato e exclusivamente das evidências fornecidas.
REGRAS OBRIGATÓRIAS:
- Não diagnostique, não estime probabilidade diagnóstica e não afirme que uma condição está presente.
- Apresente possibilidades apenas como fatores gerais que podem estar relacionados, deixando explícito que não é possível confirmar pelo questionário.
- Não prescreva medicamentos, exercícios, tratamentos nem indique que a pessoa deve ignorar sintomas.
- Não invente dados, resultados, referências, autores, datas ou recomendações.
- Use somente os trechos fornecidos para afirmações científicas. Se não houver suporte, diga que a biblioteca não permite concluir.
- As fontes citadas devem ser identificadas pelos códigos S1, S2 etc. Use somente códigos existentes.
- Inclua próximos passos seguros e recomende avaliação por profissional habilitado, especialmente se houver persistência ou piora.
- O relato é de joelho; não extrapole para outras regiões.
RELATO DO PACIENTE:
${summary}
TRECHOS RECUPERADOS:
${JSON.stringify(evidence)}
Retorne somente JSON válido.`;

    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + openAiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Você gera conteúdo educativo em saúde com limites rigorosos. Não substitui avaliação profissional." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!completion.ok) {
      console.error("OpenAI report:", completion.status, (await completion.text()).slice(0, 500));
      throw new Error("Não foi possível gerar o relatório agora. Tente novamente.");
    }
    const result = await completion.json();
    let report: any;
    try { report = JSON.parse(result.choices?.[0]?.message?.content || "{}"); }
    catch { throw new Error("A resposta da IA não pôde ser validada."); }
    const allowedRefs = new Set(evidence.map((item: any) => item.ref));
    const selectedRefs = Array.isArray(report.source_refs)
      ? report.source_refs.filter((ref: string) => allowedRefs.has(ref))
      : [];
    const selectedSources = selectedRefs.map((ref: string) => {
      const item = evidence.find((entry: any) => entry.ref === ref);
      return sources.find((source: any) => source.source_id === item?.source_id);
    }).filter(Boolean);
    return json({
      ok: true,
      urgent: false,
      report: {
        summary: String(report.summary || "").slice(0, 1200),
        possibilities: Array.isArray(report.possibilities) ? report.possibilities.slice(0, 5).map((v: unknown) => String(v).slice(0, 500)) : [],
        educational: String(report.educational || "").slice(0, 2400),
        next_steps: Array.isArray(report.next_steps) ? report.next_steps.slice(0, 5).map((v: unknown) => String(v).slice(0, 400)) : [],
      },
      sources: selectedSources,
    });
  } catch (error) {
    // Se a geração falhar tecnicamente, libera a reserva para permitir nova tentativa.
    if (claimedQuestionnaireId) {
      const { error: releaseError } = await db
        .from("pain_report_generations")
        .delete()
        .eq("questionnaire_id", claimedQuestionnaireId);
      if (releaseError) console.error("Falha ao liberar reserva do questionário:", releaseError);
    }
    console.error("pain-guide-report:", error);
    return json({ error: error instanceof Error ? error.message : "Não foi possível gerar o relatório." }, 500);
  }
});
