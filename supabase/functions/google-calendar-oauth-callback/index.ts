import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function toBase64(bytes: Uint8Array) { let s = ""; bytes.forEach(b => s += String.fromCharCode(b)); return btoa(s); }
async function encrypt(value: string, secret: string) {
  const raw = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY deve ter 32 bytes em base64.");
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return { encrypted: toBase64(new Uint8Array(cipher)), iv: toBase64(iv) };
}
const html = (message: string, ok: boolean) => new Response(`<!doctype html><html lang="pt-br"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Google Agenda · OrientaDor</title><body style="font:16px Arial,sans-serif;background:#f4f7fa;color:#17364b;display:grid;min-height:100vh;place-items:center;margin:0"><main style="background:white;padding:32px;border-radius:16px;max-width:440px;box-shadow:0 8px 32px #1232"><h2>${ok ? "Google Agenda conectado" : "Não foi possível conectar"}</h2><p>${message}</p><p>Você pode fechar esta janela e voltar ao OrientaDor.</p></main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });

Deno.serve(async (req) => {
  const requestUrl = new URL(req.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const oauthError = requestUrl.searchParams.get("error");
  if (oauthError) return html("A autorização foi cancelada ou recusada no Google.", false);
  if (!code || !state) return html("A resposta do Google está incompleta.", false);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: stateRow, error: stateError } = await admin.from("google_calendar_oauth_states")
      .select("professional_id,expires_at").eq("state", state).maybeSingle();
    if (stateError || !stateRow || new Date(stateRow.expires_at).getTime() < Date.now()) {
      return html("A solicitação expirou. Volte ao OrientaDor e tente conectar novamente.", false);
    }
    await admin.from("google_calendar_oauth_states").delete().eq("state", state);

    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
    const redirectUri = Deno.env.get("GOOGLE_CALENDAR_REDIRECT_URI")!;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok) {
      console.error("Google token exchange failed", tokens.error);
      return html("O Google não concluiu a autorização. Verifique as credenciais e tente novamente.", false);
    }
    tokens.created_at = Math.floor(Date.now() / 1000);
    const encrypted = await encrypt(JSON.stringify(tokens), Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY")!);
    let googleEmail: string | null = null;
    if (tokens.access_token) {
      const info = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      if (info.ok) googleEmail = (await info.json()).email || null;
    }
    const { data: existing } = await admin.from("google_calendar_connections").select("encrypted_tokens")
      .eq("professional_id", stateRow.professional_id).maybeSingle();
    let payload: Record<string, unknown> = { ...encrypted, google_email: googleEmail, scopes: String(tokens.scope || "").split(" ").filter(Boolean), updated_at: new Date().toISOString() };
    if (!tokens.refresh_token && existing?.encrypted_tokens) {
      // A reconnect can omit refresh_token; do not overwrite an existing refresh token without a replacement.
      console.warn("Google did not return a refresh token; reconnect may require a fresh consent.");
    }
    const { error: saveError } = await admin.from("google_calendar_connections").upsert({
      professional_id: stateRow.professional_id, encrypted_tokens: encrypted.encrypted, encryption_iv: encrypted.iv,
      google_email: googleEmail, scopes: String(tokens.scope || "").split(" ").filter(Boolean), updated_at: new Date().toISOString()
    }, { onConflict: "professional_id" });
    if (saveError) throw saveError;
    return html("Sua conta Google foi autorizada. Volte ao OrientaDor para continuar.", true);
  } catch (error) {
    console.error("google-calendar-oauth-callback", error);
    return html("Ocorreu um erro ao salvar a conexão. Tente novamente.", false);
  }
});