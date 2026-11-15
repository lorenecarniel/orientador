const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Verificação inicial do webhook feita pela Meta.
  if (request.method === "GET") {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expectedToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN");

    if (mode === "subscribe" && expectedToken && token === expectedToken && challenge) {
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    return new Response("Verificação inválida.", { status: 403 });
  }

  // A Meta envia notificações de mensagens e de status por POST.
  if (request.method === "POST") {
    try {
      const payload = await request.json();

      // Por enquanto, confirma o recebimento. O processamento das mensagens
      // e o vínculo com o profissional serão adicionados na próxima etapa.
      console.log("Webhook WhatsApp recebido.", {
        object: payload?.object ?? null,
        entries: Array.isArray(payload?.entry) ? payload.entry.length : 0,
      });

      return json({ received: true });
    } catch {
      return json({ error: "Payload inválido." }, 400);
    }
  }

  return json({ error: "Método não permitido." }, 405);
});
