import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const fromB64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const toB64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));

async function decrypt(cipher: string, iv: string, secret: string) {
  const raw = fromB64(secret);
  if (raw.length !== 32) throw new Error("Invalid encryption key");
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, key, fromB64(cipher));
  return JSON.parse(new TextDecoder().decode(plain));
}
async function encrypt(value: string, secret: string) {
  const raw = fromB64(secret);
  if (raw.length !== 32) throw new Error("Invalid encryption key");
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return { encrypted_tokens: toB64(new Uint8Array(cipher)), encryption_iv: toB64(iv) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let admin: ReturnType<typeof createClient> | null = null;
  let appointmentId: string | null = null;
  let professionalId: string | null = null;
  try {
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!bearer) return json({ error: "Sessão não informada." }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${bearer}` } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Sessão inválida." }, 401);
    professionalId = user.id;

    const body = await req.json();
    appointmentId = String(body.appointment_id || "");
    const action = String(body.action || "sync");
    if (!appointmentId || !["sync", "start", "cancel"].includes(action)) return json({ error: "Informe um agendamento e uma ação válida." }, 400);

    const { data: appointment, error: appointmentError } = await admin
      .from("appointments")
      .select("id,professional_id,starts_at,ends_at,status,modality,google_calendar_event_id")
      .eq("id", appointmentId)
      .eq("professional_id", user.id)
      .maybeSingle();
    if (appointmentError || !appointment) return json({ error: "Agendamento não encontrado ou sem permissão." }, 404);

    const { data: connection, error: connectionError } = await admin
      .from("google_calendar_connections")
      .select("encrypted_tokens,encryption_iv")
      .eq("professional_id", user.id)
      .maybeSingle();
    if (connectionError || !connection) {
      await admin.from("appointments").update({
        google_calendar_sync_status: "error",
        google_calendar_sync_error: "Conta Google não conectada."
      }).eq("id", appointmentId).eq("professional_id", user.id);
      return json({ error: "Conecte sua conta Google nas configurações para sincronizar este agendamento." }, 409);
    }

    const secret = Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY")!;
    const tokens = await decrypt(connection.encrypted_tokens, connection.encryption_iv, secret);
    let accessToken = tokens.access_token;
    const expiresAt = (Number(tokens.created_at || 0) + Number(tokens.expires_in || 0) - 60) * 1000;
    if (!accessToken || !tokens.expires_in || Date.now() > expiresAt) {
      if (!tokens.refresh_token) return json({ error: "A autorização Google expirou. Reconecte sua conta." }, 401);
      const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
          client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
          refresh_token: tokens.refresh_token,
          grant_type: "refresh_token",
        }),
      });
      const refreshed = await refreshResponse.json();
      if (!refreshResponse.ok) throw new Error("Google token refresh failed");
      Object.assign(tokens, refreshed, {
        created_at: Math.floor(Date.now() / 1000),
        refresh_token: refreshed.refresh_token || tokens.refresh_token,
      });
      const encrypted = await encrypt(JSON.stringify(tokens), secret);
      await admin.from("google_calendar_connections").update({
        ...encrypted, updated_at: new Date().toISOString()
      }).eq("professional_id", user.id);
      accessToken = tokens.access_token;
    }

    const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
    const eventId = appointment.google_calendar_event_id;
    if (action === "cancel" || appointment.status === "cancelled") {
      if (eventId) {
        const deleted = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
          method: "DELETE", headers,
        });
        if (!deleted.ok && deleted.status !== 404 && deleted.status !== 410) {
          const detail = await deleted.text();
          console.error("Google Calendar delete failed", deleted.status, detail.slice(0, 300));
          throw new Error("Google Calendar delete failed");
        }
      }
      await admin.from("appointments").update({
        google_calendar_event_id: null,
        google_calendar_event_url: null,
        google_meet_url: null,
        google_calendar_sync_status: "cancelled",
        google_calendar_sync_error: null,
      }).eq("id", appointmentId).eq("professional_id", user.id);
      return json({ synced: true, action: "cancelled" });
    }

    const start = new Date(appointment.starts_at);
    const end = new Date(appointment.ends_at);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      return json({ error: "O horário do agendamento é inválido." }, 400);
    }

    // Do not send patient identifiers or clinical information to Google Calendar.
    const eventBody: Record<string, unknown> = {
      summary: "Consulta · OrientaDor",
      description: "Evento criado pelo OrientaDor. Consulte os detalhes do atendimento diretamente na plataforma.",
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    };

    let response: Response;
    if (action === "start" && appointment.modality === "online") {
      eventBody.conferenceData = {
        createRequest: {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      };
    }

    let response: Response;
    if (eventId) {
      response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}${action === "start" ? "?conferenceDataVersion=1" : ""}`, {
        method: "PATCH", headers, body: JSON.stringify(eventBody),
      });
    } else {
      response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all", {
        method: "POST", headers, body: JSON.stringify(eventBody),
      });
    }

    const result = await response.json();
    if (!response.ok) {
      console.error("Google Calendar event error", response.status, result.error?.status);
      throw new Error("Google Calendar event sync failed");
    }
    const meetUrl = result.hangoutLink || result.conferenceData?.entryPoints?.find((p: any) => p.entryPointType === "video")?.uri || null;
    const { error: saveError } = await admin.from("appointments").update({
      google_calendar_event_id: result.id || eventId,
      google_calendar_event_url: result.htmlLink || null,
      google_meet_url: meetUrl,
      google_calendar_sync_status: "synced",
      google_calendar_sync_error: null,
    }).eq("id", appointmentId).eq("professional_id", user.id);
    if (saveError) throw saveError;
    return json({ synced: true, event_id: result.id || eventId, event_url: result.htmlLink || null, meet_url: meetUrl });
  } catch (error) {
    console.error("google-calendar-create-event", error);
    if (admin && appointmentId && professionalId) {
      await admin.from("appointments").update({
        google_calendar_sync_status: "error",
        google_calendar_sync_error: "Não foi possível sincronizar com o Google Agenda."
      }).eq("id", appointmentId).eq("professional_id", professionalId);
    }
    return json({ error: "Não foi possível sincronizar o agendamento com o Google Agenda." }, 500);
  }
});
