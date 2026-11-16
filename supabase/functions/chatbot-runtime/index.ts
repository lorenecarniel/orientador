import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Node = {
  id: string;
  type: string;
  title?: string;
  text?: string;
  condition?: { variable?: string; operator?: string; value?: string };
};
type Edge = { source: string; target: string; label?: string };
type Definition = { nodes?: Node[]; edges?: Edge[] };
type Session = {
  id: string;
  professional_id: string;
  chatbot_id: string;
  flow_id: string;
  flow_version: number;
  current_node_id: string | null;
  variables: Record<string, unknown>;
  status: string;
  patient_name: string | null;
};

const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};
const newToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
};
const interpolate = (value: string, vars: Record<string, unknown>, professionalName: string) =>
  value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key) => {
    if (key === "nome_profissional") return professionalName || "nossa equipe";
    return String(vars[key] ?? "");
  });

async function addMessage(conversationId: string, direction: "inbound" | "outbound", content: string, metadata: Record<string, unknown> = {}) {
  const { error } = await db.from("chatbot_messages").insert({
    conversation_id: conversationId,
    direction,
    message_type: "text",
    content,
    metadata,
  });
  if (error) throw error;
}

function nextNode(definition: Definition, node: Node, label?: string): Node | null {
  const nodes = definition.nodes || [];
  const edges = (definition.edges || []).filter((edge) => edge.source === node.id);
  let target: string | undefined;
  if (label !== undefined) {
    target = edges.find((edge) => (edge.label || "").trim().toLocaleLowerCase() === label.trim().toLocaleLowerCase())?.target;
  } else {
    target = edges[0]?.target;
  }
  if (target) return nodes.find((item) => item.id === target) || null;
  const index = nodes.findIndex((item) => item.id === node.id);
  return nodes[index + 1] || null;
}

function evaluateCondition(node: Node, variables: Record<string, unknown>): boolean {
  const rule = node.condition || {};
  const actual = String(variables[rule.variable || ""] ?? "").trim();
  const expected = String(rule.value || "").trim();
  if (rule.operator === "not_empty") return actual.length > 0;
  if (rule.operator === "empty") return actual.length === 0;
  if (rule.operator === "contains") return actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
  return actual.toLocaleLowerCase() === expected.toLocaleLowerCase();
}

async function advance(session: Session, definition: Definition, firstNode: Node, professionalName: string, vars: Record<string, unknown>) {
  let node: Node | null = firstNode;
  const precedingMessages: string[] = [];
  let steps = 0;
  while (node && steps++ < 40) {
    const content = interpolate(node.text || node.title || "", vars, professionalName);
    await db.from("chatbot_conversations").update({
      current_node_id: node.id,
      variables: vars,
      patient_name: vars.nome_paciente ? String(vars.nome_paciente) : session.patient_name,
      last_message_at: new Date().toISOString(),
    }).eq("id", session.id);

    if (node.type === "start") {
      node = nextNode(definition, node);
      continue;
    }
    if (node.type === "message") {
      await addMessage(session.id, "outbound", content, { node_id: node.id, node_type: node.type });
      precedingMessages.push(content);
      node = nextNode(definition, node);
      continue;
    }
    if (node.type === "condition") {
      const passed = evaluateCondition(node, vars);
      const branch = (definition.edges || []).filter((edge) => edge.source === node!.id);
      const chosen = branch.find((edge) => passed
        ? /^(sim|true|yes|verdadeiro)$/i.test((edge.label || "").trim())
        : /^(não|nao|false|no|falso)$/i.test((edge.label || "").trim()));
      node = chosen ? (definition.nodes || []).find((item) => item.id === chosen.target) || null : null;
      if (!chosen) throw new Error("Condição sem saída Sim/Não publicada.");
      continue;
    }
    if (node.type === "appointment") {
      const { data: services, error: serviceError } = await db.from("appointment_types")
        .select("id,name,duration_minutes,price").eq("professional_id", session.professional_id).eq("is_active", true).order("name");
      if (serviceError) throw serviceError;
      if (!services?.length) {
        const notice = "No momento, não há tipos de consulta disponíveis para agendamento. Vou encaminhar sua solicitação à equipe.";
        await addMessage(session.id, "outbound", notice, { node_id: node.id, node_type: node.type });
        await db.from("chatbot_conversations").update({ status: "waiting_human", current_node_id: node.id, variables: vars, last_message_at: new Date().toISOString() }).eq("id", session.id);
        return { status: "waiting_human", message: notice, variables: vars };
      }
      const choices = services.map((service) => ({
        label: service.name + " · " + service.duration_minutes + " min",
        value: "service:" + service.id,
      }));
      const prompt = content || "Qual tipo de consulta você deseja agendar?";
      await addMessage(session.id, "outbound", prompt, { node_id: node.id, node_type: node.type, choices });
      await db.from("chatbot_conversations").update({ current_node_id: node.id, variables: { ...vars, appointment_step: "service" }, last_message_at: new Date().toISOString() }).eq("id", session.id);
      return { status: "waiting_input", node_type: "appointment", appointment_step: "service", message: prompt, preceding_messages: precedingMessages, choices, variables: { ...vars, appointment_step: "service" } };
    }
    if (node.type === "question" || node.type === "options") {
      const choices = node.type === "options"
        ? (definition.edges || []).filter((edge) => edge.source === node!.id).map((edge) => ({ label: edge.label || "", value: edge.label || "" }))
        : [];
      await addMessage(session.id, "outbound", content, { node_id: node.id, node_type: node.type, choices });
      await db.from("chatbot_conversations").update({ current_node_id: node.id, variables: vars, last_message_at: new Date().toISOString() }).eq("id", session.id);
      return { status: "waiting_input", node_type: node.type, message: content, preceding_messages: precedingMessages, choices, variables: vars };
    }
    if (node.type === "handoff") {
      await addMessage(session.id, "outbound", content || "Vou encaminhar você para nossa equipe de atendimento.", { node_id: node.id, node_type: node.type });
      await db.from("chatbot_conversations").update({ status: "waiting_human", current_node_id: node.id, variables: vars, last_message_at: new Date().toISOString() }).eq("id", session.id);
      const { data: professional } = await db.from("professional_profiles").select("phone").eq("id", session.professional_id).maybeSingle();
      return { status: "waiting_human", message: content, variables: vars, professional_phone: professional?.phone || null };
    }
    if (node.type === "end") {
      await addMessage(session.id, "outbound", content || "Atendimento finalizado.", { node_id: node.id, node_type: node.type });
      await db.from("chatbot_conversations").update({ status: "closed", current_node_id: node.id, variables: vars, closed_at: new Date().toISOString(), last_message_at: new Date().toISOString() }).eq("id", session.id);
      return { status: "closed", message: content, variables: vars };
    }
    if (node.type === "action") {
      const notice = "Esta etapa depende de uma integração externa que ainda não foi conectada. Vou encaminhar sua solicitação para a equipe.";
      await addMessage(session.id, "outbound", notice, { node_id: node.id, node_type: node.type, integration_pending: true });
      await db.from("chatbot_conversations").update({ status: "waiting_human", current_node_id: node.id, variables: vars, last_message_at: new Date().toISOString() }).eq("id", session.id);
      const { data: professional } = await db.from("professional_profiles").select("phone").eq("id", session.professional_id).maybeSingle();
      return { status: "integration_pending", message: notice, variables: vars, professional_phone: professional?.phone || null };
    }
    throw new Error("O fluxo contém um tipo de bloco não reconhecido.");
  }
  if (steps >= 40) throw new Error("O fluxo excedeu o limite de etapas automáticas. Revise possíveis ciclos.");
  await db.from("chatbot_conversations").update({ status: "closed", variables: vars, closed_at: new Date().toISOString(), last_message_at: new Date().toISOString() }).eq("id", session.id);
  return { status: "closed", message: "O fluxo chegou ao fim.", variables: vars };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const body = await request.json();
    if (body.action === "start") {
      const chatbotId = String(body.chatbot_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(chatbotId)) return json({ error: "Identificador do chatbot inválido." }, 400);

      const { data: bot, error: botError } = await db.from("chatbots").select("id,professional_id,status").eq("id", chatbotId).eq("status", "published").maybeSingle();
      if (botError || !bot) return json({ error: "Chatbot não encontrado ou não publicado." }, 404);

      const { data: flow, error: flowError } = await db.from("chatbot_flows").select("id,name,version,definition").eq("chatbot_id", bot.id).eq("status", "published").order("version", { ascending: false }).limit(1).maybeSingle();
      if (flowError || !flow) return json({ error: "Não há versão publicada deste fluxo." }, 404);

      const definition = (flow.definition || {}) as Definition;
      const nodes = definition.nodes || [];
      const start = nodes.find((node) => node.type === "start");
      if (!start) return json({ error: "O fluxo publicado não possui bloco de início." }, 422);

      const { data: profile } = await db.from("professional_profiles").select("full_name,avatar_url").eq("id", bot.professional_id).maybeSingle();
      const professionalName = profile?.full_name || "nossa equipe";
      const professionalAvatarUrl = profile?.avatar_url || null;
      const token = newToken();
      const tokenHash = await sha256(token);
      const { data: conversation, error: conversationError } = await db.from("chatbot_conversations").insert({
        professional_id: bot.professional_id,
        chatbot_id: bot.id,
        flow_id: flow.id,
        flow_version: flow.version,
        channel: "web",
        status: "open",
        current_node_id: start.id,
        variables: {},
        is_test: false,
        runtime_token_hash: tokenHash,
      }).select("id,professional_id,chatbot_id,flow_id,flow_version,current_node_id,variables,status,patient_name").single();
      if (conversationError || !conversation) throw conversationError || new Error("Não foi possível iniciar a conversa.");

      const result = await advance(conversation as Session, definition, start, professionalName, {});
      return json({ conversation_id: conversation.id, session_token: token, flow_version: flow.version, professional_name: professionalName, professional_avatar_url: professionalAvatarUrl, ...result });
    }

    if (body.action === "sync" || body.action === "patient_message") {
      const conversationId = String(body.conversation_id || "");
      const token = String(body.session_token || "");
      if (!/^[0-9a-f-]{36}$/i.test(conversationId) || token.length < 32) return json({ error: "Sessão inválida." }, 400);
      const tokenHash = await sha256(token);
      const { data: conversation, error } = await db.from("chatbot_conversations")
        .select("id,status,professional_id").eq("id", conversationId).eq("runtime_token_hash", tokenHash).maybeSingle();
      if (error || !conversation) return json({ error: "Sessão não encontrada." }, 404);
      if (body.action === "patient_message") {
        const content = String(body.message || "").trim();
        if (!content || content.length > 2000) return json({ error: "Mensagem inválida." }, 400);
        if (!["waiting_human", "in_progress"].includes(conversation.status)) return json({ error: "Esta conversa não está recebendo mensagens." }, 409);
        const { error: insertError } = await db.from("chatbot_messages").insert({
          conversation_id: conversationId, direction: "inbound", message_type: "text",
          content, sender_type: "patient", metadata: { source: "web_widget" }
        });
        if (insertError) throw insertError;
        await db.from("chatbot_conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversationId);
        return json({ status: conversation.status, accepted: true });
      }
      const cursor = String(body.after || "1970-01-01T00:00:00.000Z");
      const { data: messages, error: messagesError } = await db.from("chatbot_messages")
        .select("id,direction,content,created_at,sender_type").eq("conversation_id", conversationId)
        .gt("created_at", cursor).order("created_at", { ascending: true }).limit(100);
      if (messagesError) throw messagesError;
      return json({ status: conversation.status, messages: messages || [] });
    }

    if (body.action === "reply") {
      const conversationId = String(body.conversation_id || "");
      const token = String(body.session_token || "");
      const answer = String(body.answer || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(conversationId) || token.length < 32 || !answer || answer.length > 2000) {
        return json({ error: "Resposta ou sessão inválida." }, 400);
      }
      const tokenHash = await sha256(token);
      const { data: conversation, error: conversationError } = await db.from("chatbot_conversations")
        .select("id,professional_id,chatbot_id,flow_id,flow_version,current_node_id,variables,status,patient_name")
        .eq("id", conversationId).eq("runtime_token_hash", tokenHash).maybeSingle();
      if (conversationError || !conversation) return json({ error: "Sessão não encontrada." }, 404);
      if (conversation.status !== "open") return json({ error: "Esta conversa não está aberta para novas respostas." }, 409);

      const { data: flow, error: flowError } = await db.from("chatbot_flows").select("definition").eq("id", conversation.flow_id).eq("status", "published").maybeSingle();
      if (flowError || !flow) return json({ error: "A versão do fluxo desta conversa não está disponível." }, 404);
      const definition = flow.definition as Definition;
      const node = (definition.nodes || []).find((item) => item.id === conversation.current_node_id);
      if (!node || (node.type !== "question" && node.type !== "options" && node.type !== "appointment")) return json({ error: "A conversa não está aguardando uma resposta." }, 409);

      let next: Node | null;
      const vars = { ...(conversation.variables || {}) } as Record<string, unknown>;
      if (node.type === "appointment") {
        const step = String(vars.appointment_step || "service");
        await addMessage(conversation.id, "inbound", answer, { node_id: node.id, node_type: node.type, appointment_step: step });
        if (step === "service") {
          const serviceId = answer.startsWith("service:") ? answer.slice(8) : "";
          const { data: service } = await db.from("appointment_types").select("id,name,duration_minutes").eq("id", serviceId).eq("professional_id", conversation.professional_id).eq("is_active", true).maybeSingle();
          if (!service) return json({ error: "Selecione um tipo de consulta disponível." }, 400);
          vars.appointment_type_id = service.id; vars.appointment_type_name = service.name; vars.appointment_duration = service.duration_minutes; vars.appointment_step = "date";
          const dates = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i + 1); return d.toISOString().slice(0, 10); });
          const choices = dates.map((date) => ({ label: new Date(date + "T12:00:00").toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit" }), value: "date:" + date }));
          const message = "Qual data é melhor para você?";
          await addMessage(conversation.id, "outbound", message, { node_id: node.id, node_type: node.type, choices });
          await db.from("chatbot_conversations").update({ variables: vars, last_message_at: new Date().toISOString() }).eq("id", conversation.id);
          return json({ status: "waiting_input", node_type: "appointment", appointment_step: "date", message, choices, variables: vars });
        }
        if (step === "date") {
          const date = answer.startsWith("date:") ? answer.slice(5) : "";
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Escolha uma data disponível." }, 400);
          const { data: slots, error: slotError } = await db.rpc("get_available_slots", { p_professional_id: conversation.professional_id, p_date: date, p_duration_minutes: Number(vars.appointment_duration) });
          if (slotError) throw slotError;
          const choices = (slots || []).map((slot: { starts_at: string }) => ({ label: new Date(slot.starts_at).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }), value: "time:" + slot.starts_at }));
          if (!choices.length) return json({ status: "waiting_input", node_type: "appointment", appointment_step: "date", message: "Não encontrei horários livres nessa data. Escolha outra data.", choices: (Array.from({length:14},(_,i)=>{const d=new Date();d.setDate(d.getDate()+i+1);return d.toISOString().slice(0,10)})).map((d)=>({label:new Date(d+"T12:00:00").toLocaleDateString("pt-BR",{timeZone:"America/Sao_Paulo",weekday:"short",day:"2-digit",month:"2-digit"}),value:"date:"+d})) });
          vars.appointment_date = date; vars.appointment_step = "time";
          const message = "Estes são os horários disponíveis. Escolha um:";
          await addMessage(conversation.id, "outbound", message, { node_id: node.id, node_type: node.type, choices });
          await db.from("chatbot_conversations").update({ variables: vars, last_message_at: new Date().toISOString() }).eq("id", conversation.id);
          return json({ status: "waiting_input", node_type: "appointment", appointment_step: "time", message, choices, variables: vars });
        }
        if (step === "time") {
          const startsAt = answer.startsWith("time:") ? answer.slice(5) : "";
          const { data: slots, error: slotError } = await db.rpc("get_available_slots", { p_professional_id: conversation.professional_id, p_date: vars.appointment_date, p_duration_minutes: Number(vars.appointment_duration) });
          if (slotError) throw slotError;
          const valid = (slots || []).some((slot: { starts_at: string }) => new Date(slot.starts_at).toISOString() === new Date(startsAt).toISOString());
          if (!valid) return json({ error: "Esse horário não está mais disponível. Escolha outra data." }, 409);
          vars.appointment_starts_at = startsAt; vars.appointment_step = "name";
          const message = "Perfeito! Qual é seu nome completo?";
          await addMessage(conversation.id, "outbound", message, { node_id: node.id, node_type: node.type });
          await db.from("chatbot_conversations").update({ variables: vars, last_message_at: new Date().toISOString() }).eq("id", conversation.id);
          return json({ status: "waiting_input", node_type: "appointment", appointment_step: "name", message, variables: vars });
        }
        if (step === "name") {
          if (answer.length < 3) return json({ error: "Informe seu nome completo." }, 400);
          vars.nome_paciente = answer; vars.appointment_patient_name = answer; vars.appointment_step = "phone";
          const message = "Qual telefone com DDD podemos usar para contato?";
          await addMessage(conversation.id, "outbound", message, { node_id: node.id, node_type: node.type });
          await db.from("chatbot_conversations").update({ variables: vars, patient_name: answer, last_message_at: new Date().toISOString() }).eq("id", conversation.id);
          return json({ status: "waiting_input", node_type: "appointment", appointment_step: "phone", message, variables: vars });
        }
        if (step === "phone") {
          const phone = answer.replace(/\D/g, "");
          if (phone.length < 10 || phone.length > 13) return json({ error: "Informe um telefone válido com DDD." }, 400);
          vars.appointment_phone = phone; vars.appointment_step = "confirm";
          const summary = "Confirme seu agendamento:\n" + String(vars.appointment_type_name) + "\n" + new Date(String(vars.appointment_starts_at)).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) + "\nPaciente: " + String(vars.appointment_patient_name);
          const choices = [{ label: "Confirmar agendamento", value: "confirm:yes" }, { label: "Cancelar", value: "confirm:no" }];
          await addMessage(conversation.id, "outbound", summary, { node_id: node.id, node_type: node.type, choices });
          await db.from("chatbot_conversations").update({ variables: vars, last_message_at: new Date().toISOString() }).eq("id", conversation.id);
          return json({ status: "waiting_input", node_type: "appointment", appointment_step: "confirm", message: summary, choices, variables: vars });
        }
        if (step === "confirm") {
          if (answer !== "confirm:yes") {
            vars.appointment_step = "service";
            const { data: services } = await db.from("appointment_types").select("id,name,duration_minutes").eq("professional_id", conversation.professional_id).eq("is_active", true).order("name");
            const choices = (services || []).map((service) => ({ label: service.name + " · " + service.duration_minutes + " min", value: "service:" + service.id }));
            const message = "Tudo bem. Vamos recomeçar. Qual tipo de consulta deseja?";
            await db.from("chatbot_conversations").update({ variables: vars, last_message_at: new Date().toISOString() }).eq("id", conversation.id);
            return json({ status: "waiting_input", node_type: "appointment", appointment_step: "service", message, choices, variables: vars });
          }
          const startsAt = new Date(String(vars.appointment_starts_at));
          const endsAt = new Date(startsAt.getTime() + Number(vars.appointment_duration) * 60000);
          const { error: bookingError } = await db.rpc("book_appointment", {
            p_professional_id: conversation.professional_id, p_patient_name: String(vars.appointment_patient_name),
            p_patient_phone: String(vars.appointment_phone), p_patient_email: null, p_starts_at: startsAt.toISOString(),
            p_ends_at: endsAt.toISOString(), p_appointment_type_id: String(vars.appointment_type_id),
            p_conversation_id: conversation.id, p_source: "chatbot", p_notes: null,
          });
          if (bookingError) throw bookingError;
          vars.appointment_step = "completed";
          await db.from("chatbot_conversations").update({ variables: vars, last_message_at: new Date().toISOString() }).eq("id", conversation.id);
          const message = "Agendamento confirmado! Você receberá o atendimento no horário combinado.";
          await addMessage(conversation.id, "outbound", message, { node_id: node.id, node_type: node.type, appointment_confirmed: true });
          next = nextNode(definition, node);
        } else return json({ error: "Etapa de agendamento inválida." }, 409);
      } else if (node.type === "question") {
        const variable = (node.text || "").match(/\{\{\s*([\w.-]+)\s*\}\}/)?.[1] || "resposta";
        vars[variable] = answer;
        next = nextNode(definition, node);
        await addMessage(conversation.id, "inbound", answer, { node_id: node.id, node_type: node.type });
      } else {
        const edge = (definition.edges || []).find((item) => item.source === node.id && (item.label || "").trim().toLocaleLowerCase() === answer.toLocaleLowerCase());
        if (!edge) return json({ error: "Escolha uma das opções disponíveis." }, 400);
        next = (definition.nodes || []).find((item) => item.id === edge.target) || null;
        await addMessage(conversation.id, "inbound", answer, { node_id: node.id, node_type: node.type });
      }
      const { data: profile } = await db.from("professional_profiles").select("full_name").eq("id", conversation.professional_id).maybeSingle();
      if (!next) {
        await db.from("chatbot_conversations").update({ status: "closed", variables: vars, closed_at: new Date().toISOString(), last_message_at: new Date().toISOString() }).eq("id", conversation.id);
        return json({ status: "closed", message: "O fluxo chegou ao fim.", variables: vars });
      }
      const result = await advance(conversation as Session, definition, next, profile?.full_name || "nossa equipe", vars);
      return json({ conversation_id: conversation.id, ...result });
    }
    return json({ error: "Ação não reconhecida." }, 400);
  } catch (error) {
    console.error("chatbot-runtime error", error);
    return json({ error: error instanceof Error ? error.message : "Erro interno do atendimento." }, 500);
  }
});
