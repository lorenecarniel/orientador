import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const body = await req.json();
    // Honeypot silencioso para formulários automatizados.
    if (body.website) return json({ ok: true });
    const professionalId = String(body.professional_id || "");
    const name = String(body.patient_name || "").trim();
    const phone = String(body.patient_phone || "").trim();
    const email = String(body.patient_email || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(professionalId))
      return json({ error: "Profissional inválido." }, 400);
    if (name.length < 2 || name.length > 140 || phone.replace(/\D/g, "").length < 8 || phone.length > 30)
      return json({ error: "Informe nome e WhatsApp válidos." }, 400);
    if (email && (email.length > 180 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
      return json({ error: "E-mail inválido." }, 400);
    if (body.consent !== true) return json({ error: "É necessário autorizar o envio das respostas." }, 400);
    const answers = body.assessment_answers && typeof body.assessment_answers === "object" ? body.assessment_answers : null;
    const summary = body.assessment_summary && typeof body.assessment_summary === "object" ? body.assessment_summary : {};
    if (!answers || JSON.stringify(answers).length > 24000 || JSON.stringify(summary).length > 8000)
      return json({ error: "Não foi possível validar as respostas do questionário." }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, key, { auth: { persistSession: false } });
    const { data: professional, error: profileError } = await admin
      .from("professional_profiles").select("id,is_public").eq("id", professionalId).maybeSingle();
    if (profileError || !professional?.is_public) return json({ error: "Este profissional não está disponível para receber contatos." }, 404);

    const { error } = await admin.from("pre_consultations").insert({
      professional_id: professionalId, patient_name: name, patient_phone: phone,
      patient_email: email || null, region: String(body.region || "").slice(0, 80) || null,
      side: String(body.side || "").slice(0, 40) || null,
      assessment_answers: answers, assessment_summary: summary,
      triage_risk: String(body.triage_risk || "").slice(0, 40) || null,
      consent_at: new Date().toISOString()
    });
    if (error) throw error;
    return json({ ok: true });
  } catch (error) {
    console.error("submit-pre-consultation:", error);
    return json({ error: "Não foi possível enviar sua pré-consulta. Tente novamente." }, 500);
  }
});
