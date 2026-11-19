import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";
import mammoth from "npm:mammoth@1.9.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://orientador.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const openAiKey = Deno.env.get("OPENAI_API_KEY")!;
const adminDb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

function splitIntoChunks(text: string, size = 6000, overlap = 600): string[] {
  const normalized = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + size, normalized.length);
    if (end < normalized.length) {
      const boundary = Math.max(
        normalized.lastIndexOf("\n\n", end),
        normalized.lastIndexOf(". ", end),
        normalized.lastIndexOf("; ", end),
      );
      if (boundary > start + Math.floor(size * 0.65)) end = boundary + 1;
    }
    const part = normalized.slice(start, end).trim();
    if (part.length > 80) chunks.push(part);
    if (end >= normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

async function extractAttachment(path: string): Promise<string> {
  const { data, error } = await adminDb.storage.from("knowledge-library").download(path);
  if (error || !data) throw new Error("Não foi possível baixar o anexo privado.");
  const bytes = new Uint8Array(await data.arrayBuffer());
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (ext === "txt") return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (ext === "pdf") {
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: true });
    return typeof result.text === "string" ? result.text : "";
  }
  if (ext === "docx") {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value || "";
  }
  throw new Error("Formato não suportado. Envie PDF, DOCX ou TXT.");
}

async function createEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": "Bearer " + openAiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error("Falha ao gerar embeddings (" + response.status + "): " + detail.slice(0, 500));
  }
  const payload = await response.json();
  return (payload.data || []).sort((a: { index: number }, b: { index: number }) => a.index - b.index)
    .map((item: { embedding: number[] }) => item.embedding);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const headers = { ...corsHeaders, "Access-Control-Allow-Origin": origin || "null" };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    if (!openAiKey) return json({ error: "A chave OPENAI_API_KEY ainda não foi configurada nos secrets do Supabase." }, 503);
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Autenticação necessária." }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Sessão inválida ou expirada." }, 401);
    const { data: role, error: roleError } = await adminDb.from("platform_roles")
      .select("role").eq("user_id", authData.user.id).eq("role", "admin").maybeSingle();
    if (roleError || !role) return json({ error: "Apenas administradores podem processar a biblioteca." }, 403);

    const body = await req.json();
    const sourceId = String(body.source_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceId))
      return json({ error: "Identificador do material inválido." }, 400);

    const { data: source, error: sourceError } = await adminDb.from("knowledge_sources")
      .select("id,title,category,source_type,author,institution,publication_year,source_url,content_text,storage_path,status")
      .eq("id", sourceId).maybeSingle();
    if (sourceError || !source) return json({ error: "Material não encontrado." }, 404);
    if (source.status !== "approved") return json({ error: "Aprove o material antes de processá-lo." }, 409);

    await adminDb.from("knowledge_sources").update({
      processing_status: "processing", processing_error: null, processed_at: null,
    }).eq("id", sourceId);

    let extracted = String(source.content_text || "").trim();
    if (source.storage_path) {
      const attachmentText = await extractAttachment(source.storage_path);
      extracted = [extracted, attachmentText].filter(Boolean).join("\n\n");
    }
    extracted = extracted.replace(/\u0000/g, "").trim();
    if (extracted.length < 100) throw new Error("Não foi possível extrair texto suficiente. Se o PDF for digitalizado como imagem, será necessário OCR, ainda não disponível.");
    if (extracted.length > 500000) extracted = extracted.slice(0, 500000);

    const chunks = splitIntoChunks(extracted);
    if (!chunks.length) throw new Error("O material não gerou trechos de texto para indexação.");
    await adminDb.from("knowledge_chunks").delete().eq("source_id", sourceId);

    let inserted = 0;
    for (let offset = 0; offset < chunks.length; offset += 64) {
      const batch = chunks.slice(offset, offset + 64);
      const embeddings = await createEmbeddings(batch);
      if (embeddings.length !== batch.length) throw new Error("A quantidade de embeddings retornada não corresponde aos trechos.");
      const rows = batch.map((content, index) => ({
        source_id: sourceId,
        chunk_index: offset + index,
        content,
        token_estimate: Math.ceil(content.length / 4),
        embedding: JSON.stringify(embeddings[index]),
        metadata: {
          title: source.title, category: source.category, source_type: source.source_type,
          author: source.author, institution: source.institution,
          publication_year: source.publication_year, source_url: source.source_url,
        },
      }));
      const { error: insertError } = await adminDb.from("knowledge_chunks").insert(rows);
      if (insertError) throw insertError;
      inserted += rows.length;
    }

    await adminDb.from("knowledge_sources").update({
      processing_status: "processed", processing_error: null, processed_at: new Date().toISOString(),
    }).eq("id", sourceId);
    return json({ ok: true, source_id: sourceId, chunks_created: inserted, characters_processed: extracted.length });
  } catch (error) {
    console.error("process-knowledge-source:", error);
    const message = error instanceof Error ? error.message : "Falha ao processar material.";
    try {
      const body = await req.clone().json();
      if (body.source_id) await adminDb.from("knowledge_sources").update({
        processing_status: "failed", processing_error: message.slice(0, 1000),
      }).eq("id", String(body.source_id));
    } catch { /* no-op */ }
    return json({ error: message }, 500);
  }
});
