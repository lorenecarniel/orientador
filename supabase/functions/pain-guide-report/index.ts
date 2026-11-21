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
  if (a.heat === "Sim" && a.fever !== "Sim" && (a.swelling === "Um pouco" || a.swelling === "Bastante"))
    flags.push("Joelho quente ou avermelhado junto com inchaço: é necessária avaliação presencial prioritária, mesmo sem febre.");
  if (a.walk === "Não consigo caminhar" || a.weight === "Não consigo apoiar")
    flags.push("Incapacidade relatada de caminhar ou apoiar o peso.");
  if (a.lock === "Sim" && a.walk !== "Não consigo caminhar")
    flags.push("Relato de travamento ou falseio do joelho: é importante avaliação presencial antes de orientar exercícios.");
  return flags;
}

const PRACTICAL_SOURCES = [
  {
    source_id: "external-nhs-knee-pain",
    title: "Knee pain: self-care and when to seek help",
    category: "autocuidado",
    source_type: "Orientação oficial ao paciente",
    author: "NHS",
    institution: "National Health Service",
    publication_year: 2023,
    source_url: "https://www.nhs.uk/symptoms/knee-pain/",
  },
  {
    source_id: "external-nhsinform-knee",
    title: "Knee problems: ice, heat and movement",
    category: "autocuidado",
    source_type: "Orientação oficial ao paciente",
    author: "NHS Inform",
    institution: "NHS Scotland",
    publication_year: 2026,
    source_url: "https://www.nhsinform.scot/illnesses-and-conditions/muscle-bone-and-joints/leg-and-foot-problems-and-conditions/knee-problems",
  },
  {
    source_id: "external-nice-ng226",
    title: "Osteoarthritis in over 16s: diagnosis and management (NG226)",
    category: "exercicios_terapeuticos",
    source_type: "Diretriz clínica",
    author: "NICE",
    institution: "National Institute for Health and Care Excellence",
    publication_year: 2022,
    source_url: "https://www.nice.org.uk/guidance/ng226/chapter/Recommendations",
  },
];

function practicalSelfCare(a: Answers) {
  const items: any[] = [];
  const swollen = a.swelling === "Um pouco" || a.swelling === "Bastante";
  const recent = a.onset === "Hoje" || a.onset === "Há alguns dias";
  if (swollen || recent) {
    items.push({
      title: "Gelo para aliviar dor e inchaço",
      recommendation: "Como você relatou início recente ou inchaço, uma compressa fria pode ajudar a aliviar o desconforto. Ela não trata a causa da dor.",
      how_to: "Coloque uma bolsa fria ou gelo envolvido em uma toalha fina sobre a região por até 20 minutos. O NHS orienta repetir a cada 2 a 3 horas, se necessário.",
      cautions: "Nunca coloque gelo diretamente na pele. Retire se houver ardência, alteração importante da sensibilidade ou irritação. Como o questionário não identifica a causa, não use isso para adiar uma avaliação se a dor estiver limitando suas atividades.",
      evidence_refs: [],
    });
  } else if (a.heat === "Não" && (a.onset === "Há algumas semanas" || a.onset === "Há alguns meses")) {
    items.push({
      title: "Gelo ou calor: escolha o que traz alívio",
      recommendation: "Quando não há inchaço ou calor relatado, tanto o frio quanto o calor podem aliviar sintomas em alguns problemas no joelho. Não existe uma escolha universal para todos os casos.",
      how_to: "Se experimentar, use uma bolsa fria ou morna envolvida em uma toalha por até 20 minutos. Faça uma pausa de algumas horas antes de repetir.",
      cautions: "Não aplique diretamente na pele e interrompa se notar vermelhidão, mudança de cor ou bolhas. Evite calor se o joelho estiver inchado ou quente.",
      evidence_refs: [],
    });
  }
  items.push({
    title: "Movimente sem forçar",
    recommendation: "Repousar não precisa significar deixar o joelho completamente parado. Se você consegue movimentá-lo sem piora importante, movimentos leves dentro do limite confortável podem ajudar a evitar rigidez.",
    how_to: "Por enquanto, reduza caminhadas longas, corrida, saltos, agachamentos e atividades que aumentem a dor. Faça apenas movimentos suaves nas atividades do dia a dia, sem insistir nem tentar vencer a dor.",
    cautions: "Não faça alongamentos fortes nem exercícios de fortalecimento por conta própria nesta etapa. Pare se a dor aumentar, surgir instabilidade ou o inchaço piorar. Exercícios específicos devem ser escolhidos após avaliação.",
    evidence_refs: [],
  });
  items.push({
    title: "Pomadas e medicamentos",
    recommendation: "O questionário não permite escolher com segurança uma pomada ou um medicamento para você. O tratamento depende da causa da dor e do seu histórico de saúde.",
    how_to: "Converse com um farmacêutico ou profissional de saúde antes de usar um produto, especialmente se toma outros medicamentos, tem alergias, problemas no estômago, rins ou coração, ou está grávida.",
    cautions: "Não comece anti-inflamatórios por conta própria nem combine produtos sem orientação. Diretrizes que recomendam anti-inflamatório tópico para osteoartrite se referem a pessoas com essa condição avaliada, não a qualquer dor no joelho.",
    evidence_refs: [],
  });
  return items;
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
          self_care: [],
          when_to_seek_help: [{ situation: flags.join(" "), action: "Procure avaliação presencial com prioridade. Se houver piora importante ou situação de emergência, procure atendimento de urgência." }],
          educational: "Quero ter cuidado com você: suas respostas mostram uma combinação de sinais que precisa ser avaliada presencialmente com prioridade. Um joelho quente ou avermelhado e inchado, principalmente quando há dificuldade para caminhar ou febre, precisa de avaliação para entender a causa. Até ser avaliado, evite exercícios, massagens e esforço sobre o joelho. Não use medidas caseiras para adiar o atendimento.",
        },
        sources: PRACTICAL_SOURCES.slice(0, 2),
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

    const care = practicalSelfCare(answers);
    if (!relevant.length) {
      return json({
        ok: true, urgent: false, report: {
          summary: "Recebemos suas respostas, mas ainda não encontramos conteúdo suficientemente relacionado na biblioteca científica para montar uma explicação personalizada.",
          possibilities: [],
          self_care: care,
          when_to_seek_help: [{ situation: "Se a dor persistir, piorar ou limitar suas atividades.", action: "Procure avaliação com um profissional de saúde habilitado." }],
          educational: "Recebemos suas respostas e queremos ajudar você a entender melhor o que está sentindo. A biblioteca ainda não trouxe um material específico para explicar a possível causa, então não vamos tentar adivinhar um diagnóstico. Mesmo assim, podemos compartilhar cuidados gerais de fontes oficiais, respeitando os sintomas que você informou.",
        }, sources: PRACTICAL_SOURCES.slice(0, 2),
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
    const prompt = `Responda em português brasileiro, em JSON válido, com estas chaves:
summary (string),
possibilities (array de objetos {title, explanation, evidence_refs}),
self_care (array de objetos {title, recommendation, how_to, cautions, evidence_refs}),
when_to_seek_help (array de objetos {situation, action}),
educational (string),
source_refs (array de strings).

PAPEL E TOM:
Você é um assistente de educação em saúde musculoesquelética. Fale com acolhimento, empatia e naturalidade, como alguém que explica com calma para uma pessoa leiga. Use frases curtas, palavras comuns e explique qualquer termo técnico. Não assuste, não julgue e não seja frio ou robótico. Reconheça que sentir dor pode ser desconfortável e que cada pessoa vive isso de um jeito.

REGRAS CLÍNICAS OBRIGATÓRIAS:
- Não diagnostique, não estime probabilidades e não diga que a pessoa tem uma doença ou lesão.
- Não use nomes de doenças específicas (por exemplo, osteoartrite ou tendinopatia) como possibilidades personalizadas. Em vez disso, explique fatores gerais somente quando os trechos sustentarem, como sobrecarga, irritação de estruturas ou alterações relacionadas ao movimento.
- O relato é sobre joelho; não extrapole para outras regiões.
- Use exclusivamente os trechos recuperados para afirmações científicas e recomendações clínicas. Não complete lacunas com conhecimento geral do modelo.
- Não invente artigos, autores, datas, instituições, links, resultados ou recomendações.
- Se os trechos não sustentarem uma orientação, não a inclua. Diga com delicadeza que a biblioteca ainda não tem informação suficiente para orientar aquele cuidado.
- Não recomende automaticamente gelo, calor, pomadas, medicamentos, alongamentos, exercícios ou repouso. Só inclua uma opção quando os trechos sustentarem claramente a indicação e as respostas do paciente não trouxerem contraindicação ou sinal de alerta.
- Não recomende nomes comerciais nem prescreva medicamentos. Para produtos tópicos, só mencione a possibilidade de conversar com farmacêutico ou profissional habilitado se a evidência fornecida justificar; nunca recomende produto específico.
- Para cada possibilidade e cuidado, inclua os códigos evidence_refs correspondentes, apenas S1, S2 etc existentes. Se não houver suporte direto, deixe o array vazio e não faça a afirmação.
- Para cuidados, explique de modo prático como fazer, por quanto tempo/frequência apenas se isso estiver explicitamente sustentado pelos trechos, e quais sinais indicam interromper. Não invente dose, duração ou frequência.
- As orientações práticas individualizadas que o sistema já preparou para este relato estão abaixo. Não as contradiga nem diga que não é seguro indicar qualquer cuidado se essa lista tiver itens. Explique em educational o que o relato permite compreender, reconheça a incerteza e complemente os cuidados listados sem repeti-los.
- Se a lista de cuidados estiver vazia, explique com delicadeza que não há orientação específica suficientemente sustentada para este caso.
- Inclua orientação de avaliação profissional se a dor persistir, piorar ou limitar atividades. Em sinais de alerta, priorize avaliação presencial e não ofereça exercícios ou autocuidado como substitutos.
- Não diga que a pessoa está segura ou que não precisa de avaliação.
- Seja claro sobre a incerteza sem ser alarmista.

FORMATO:
- summary: 2 a 4 frases, refletindo fielmente o que a pessoa contou, em linguagem simples.
- possibilities: no máximo 3 fatores gerais, com explicação acessível; não transformar em diagnóstico.
- self_care: no máximo 4 cuidados realmente sustentados pela evidência e adequados ao relato. Cada item deve ter título curto, recomendação, instruções práticas e cautelas.
- when_to_seek_help: no máximo 4 situações concretas e ação indicada.
- educational: explique de forma humana o que se pode compreender do relato e o que ainda não é possível concluir.
- source_refs: selecione somente fontes realmente usadas.

RELATO DO PACIENTE:
${summary}
CUIDADOS PRÁTICOS JÁ SELECIONADOS PARA ESTE RELATO (não contradizer):
${JSON.stringify(care)}
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
        summary: String(report.summary || "").slice(0, 1600),
        possibilities: Array.isArray(report.possibilities) ? report.possibilities.slice(0, 3).map((v: any) => ({
          title: String(v.title || "Possibilidade").slice(0, 120),
          explanation: String(v.explanation || "").slice(0, 700),
          evidence_refs: Array.isArray(v.evidence_refs) ? v.evidence_refs.filter((ref: string) => allowedRefs.has(ref)) : [],
        })) : [],
        self_care: practicalSelfCare(answers),
        when_to_seek_help: Array.isArray(report.when_to_seek_help) ? report.when_to_seek_help.slice(0, 4).map((v: any) => ({
          situation: String(v.situation || "").slice(0, 500),
          action: String(v.action || "").slice(0, 400),
        })).filter((v: any) => v.situation && v.action) : [],
        educational: String(report.educational || "").slice(0, 2600),
      },
      sources: [...selectedSources, ...PRACTICAL_SOURCES].filter((source, index, all) =>
        all.findIndex((item) => item.source_id === source.source_id) === index
      ),
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
