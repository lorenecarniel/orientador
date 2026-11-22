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
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!accessToken) return json({ error: "Configure MERCADOPAGO_ACCESS_TOKEN nos secrets do Supabase." }, 503);

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Autenticação necessária." }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Sessão inválida ou expirada." }, 401);

    const body = await req.json();
    const subscriptionId = String(body.subscription_id || "");
    if (!uuid.test(subscriptionId)) return json({ error: "Solicitação de assinatura inválida." }, 400);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: subscription, error: subError } = await admin.from("professional_subscriptions")
      .select("id,professional_id,plan_key,billing_period,status,payment_status,payment_preference_id")
      .eq("id", subscriptionId).eq("professional_id", authData.user.id).maybeSingle();
    if (subError || !subscription) return json({ error: "Assinatura não encontrada para esta conta." }, 404);
    if (subscription.status !== "pending_activation") return json({ error: "Esta assinatura não está aguardando pagamento." }, 409);
    if (subscription.payment_status === "approved") return json({ error: "Este pagamento já foi confirmado." }, 409);

    const { data: plan, error: planError } = await admin.from("plan_catalog")
      .select("name,monthly_price_cents,annual_price_cents")
      .eq("plan_key", subscription.plan_key).eq("is_active", true).maybeSingle();
    if (planError || !plan) return json({ error: "Plano indisponível para contratação." }, 409);
    const amountCents = subscription.billing_period === "annual" ? plan.annual_price_cents : plan.monthly_price_cents;
    if (!Number.isInteger(amountCents) || amountCents <= 0) return json({ error: "Preço do plano inválido." }, 500);

    const appBase = "https://lorenecarniel.github.io/orientador/atendimento/";
    const preference = {
      items: [{
        id: subscription.plan_key + "-" + subscription.billing_period,
        title: "OrientaDor - Plano " + plan.name + (subscription.billing_period === "annual" ? " Anual" : " Mensal"),
        quantity: 1,
        currency_id: "BRL",
        unit_price: amountCents / 100,
      }],
      payer: { email: authData.user.email },
      external_reference: subscription.id,
      notification_url: supabaseUrl + "/functions/v1/mercadopago-webhook",
      back_urls: {
        success: appBase + "?payment=success",
        pending: appBase + "?payment=pending",
        failure: appBase + "?payment=failure",
      },
      auto_return: "approved",
      statement_descriptor: "ORIENTADOR",
      metadata: {
        subscription_id: subscription.id,
        professional_id: authData.user.id,
        plan_key: subscription.plan_key,
        billing_period: subscription.billing_period,
      },
    };

    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Content-Type": "application/json",
        "X-Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(preference),
    });
    const mpData = await mpResponse.json();
    if (!mpResponse.ok || !mpData.id) {
      console.error("Mercado Pago preference error:", mpData);
      return json({ error: "O Mercado Pago não conseguiu criar o checkout. Verifique as credenciais e tente novamente." }, 502);
    }

    const { error: saveError } = await admin.from("professional_subscriptions").update({
      payment_provider: "mercado_pago",
      payment_status: "pending",
      payment_preference_id: String(mpData.id),
      payment_external_reference: subscription.id,
      payment_amount_cents: amountCents,
      payment_currency: "BRL",
      payment_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", subscription.id);
    if (saveError) throw saveError;

    const checkoutUrl = mpData.sandbox_init_point || mpData.init_point;
    if (!checkoutUrl) throw new Error("O Mercado Pago não retornou o endereço de checkout.");
    return json({ checkout_url: checkoutUrl, preference_id: String(mpData.id) });
  } catch (error) {
    console.error("mercadopago-create-checkout:", error);
    return json({ error: error instanceof Error ? error.message : "Não foi possível iniciar o pagamento." }, 500);
  }
});
