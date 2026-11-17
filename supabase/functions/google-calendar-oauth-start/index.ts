import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sessão não informada." }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) return json({ error: "Sessão inválida." }, 401);

    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const redirectUri = Deno.env.get("GOOGLE_CALENDAR_REDIRECT_URI");
    if (!clientId || !redirectUri) return json({ error: "Integração Google não configurada no servidor." }, 500);

    const stateBytes = crypto.getRandomValues(new Uint8Array(32));
    const state = btoa(String.fromCharCode(...stateBytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error: insertError } = await admin.from("google_calendar_oauth_states").insert({
      state, professional_id: user.id, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    });
    if (insertError) throw insertError;

    const params = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.events openid email",
      access_type: "offline", prompt: "consent", state
    });
    return json({ authorization_url: "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString() });
  } catch (error) {
    console.error("google-calendar-oauth-start", error);
    return json({ error: "Não foi possível iniciar a conexão com o Google." }, 500);
  }
});