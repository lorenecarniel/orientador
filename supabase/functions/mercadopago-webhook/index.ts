import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});

async function validSignature(secret: string, signature: string, requestId: string, paymentId: string) {
  const parts = Object.fromEntries(signature.split(",").map((part) => {
    const [key, ...value] = part.trim().split("=");
    return [key, value.join("=")];
  }));
  if (!parts.ts || !parts.v1 || !requestId || !paymentId) return false;
  const manifest = "id:" + paymentId + ";request-id:" + requestId + ";ts:" + parts.ts + ";";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest)));
  const expected = Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== parts.v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ parts.v1.toLowerCase().charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Método não permitido." }, 405);
  try {
    const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    const webhookSecret = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET");
    if (!accessToken || !webhookSecret) return json({ error: "Credenciais do webhook não configuradas." }, 503);

    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { body = {}; }
    }
    const url = new URL(req.url);
    const paymentId = String(url.searchParams.get("data.id") || url.searchParams.get("id") ||
      (body.data as Record<string, unknown> | undefined)?.id || "");
    if (!paymentId) return json({ received: true });
    const signature = req.headers.get("x-signature") || "";
    const requestId = req.headers.get("x-request-id") || "";
    if (!await validSignature(webhookSecret, signature, requestId, paymentId))
      return json({ error: "Assinatura do webhook inválida." }, 401);

    const paymentResponse = await fetch("https://api.mercadopago.com/v1/payments/" + encodeURIComponent(paymentId), {
      headers: { "Authorization": "Bearer " + accessToken },
    });
    const payment = await paymentResponse.json();
    if (!paymentResponse.ok) {
      console.error("Mercado Pago payment lookup failed:", payment);
      return json({ error: "Não foi possível consultar o pagamento." }, 502);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const subscriptionId = String(payment.external_reference || payment.metadata?.subscription_id || "");
    if (!subscriptionId) return json({ received: true, ignored: "missing_reference" });

    const { data: subscription, error } = await admin.from("professional_subscriptions")
      .select("id,professional_id,plan_key,billing_period,payment_amount_cents,payment_currency,payment_status")
      .eq("id", subscriptionId).maybeSingle();
    if (error || !subscription) return json({ error: "Assinatura vinculada não encontrada." }, 404);

    const paidCents = Math.round(Number(payment.transaction_amount || 0) * 100);
    const expectedStatus = String(payment.status || "pending");
    const allowed = ["approved", "pending", "rejected", "cancelled", "refunded", "in_process"];
    const paymentStatus = allowed.includes(expectedStatus) ? expectedStatus : "pending";
    if (payment.currency_id !== "BRL" || paidCents !== subscription.payment_amount_cents)
      return json({ error: "Valor ou moeda do pagamento não corresponde à assinatura." }, 409);

    const patch: Record<string, unknown> = {
      payment_provider: "mercado_pago",
      payment_status: paymentStatus,
      payment_id: String(payment.id),
      payment_external_reference: subscription.id,
      payment_currency: "BRL",
      payment_updated_at: new Date().toISOString(),
    };
    if (paymentStatus === "approved") patch.paid_at = payment.date_approved || new Date().toISOString();
    const { error: updateError } = await admin.from("professional_subscriptions").update(patch).eq("id", subscription.id);
    if (updateError) throw updateError;
    return json({ received: true });
  } catch (error) {
    console.error("mercadopago-webhook:", error);
    return json({ error: "Falha ao processar notificação de pagamento." }, 500);
  }
});
