import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, OPTIONS", "Content-Type": "application/json" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return new Response(JSON.stringify({ error: "Sessão não informada." }), { status: 401, headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "Sessão inválida." }), { status: 401, headers: cors });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await admin.from("google_calendar_connections").select("google_email,connected_at,updated_at,scopes").eq("professional_id", user.id).maybeSingle();
  if (error) return new Response(JSON.stringify({ error: "Não foi possível consultar a conexão." }), { status: 500, headers: cors });
  return new Response(JSON.stringify({ connected: !!data, email: data?.google_email || null, connected_at: data?.connected_at || null, scopes: data?.scopes || [] }), { headers: cors });
});