(function () {
  const script = document.currentScript;
  if (!script) return;
  const chatbotId = script.dataset.chatbotId || "";
  const supabaseUrl = (script.dataset.supabaseUrl || "").replace(/\/$/, "");
  const publishableKey = script.dataset.publishableKey || "";
  if (!chatbotId || !supabaseUrl || !publishableKey) {
    console.error("OrientaDor chat: configuração incompleta.");
    return;
  }
  // Evita criar dois widgets caso o script seja incluído mais de uma vez.
  if (document.getElementById("od-chat-launcher") || document.getElementById("od-chat-panel")) return;
  const endpoint = supabaseUrl + "/functions/v1/chatbot-runtime";
  const style = document.createElement("style");
  style.textContent = `
    #od-chat-launcher{position:fixed;right:22px;bottom:22px;z-index:2147483000;border:0;border-radius:999px;padding:15px 20px;background:#063b52;color:#fff;font:600 15px Arial;box-shadow:0 8px 26px #102b3b33;cursor:pointer}
    #od-chat-panel{position:fixed;right:22px;bottom:82px;z-index:2147483000;width:min(370px,calc(100vw - 28px));height:min(570px,calc(100vh - 115px));background:#fff;border:1px solid #dce5e9;border-radius:18px;box-shadow:0 16px 50px #102b3b35;display:none;overflow:hidden;font:14px Arial,sans-serif;color:#183746}
    #od-chat-panel.od-open{display:flex;flex-direction:column}
    #od-chat-head{padding:16px;background:#063b52;color:#fff;display:flex;justify-content:space-between;align-items:center}
    #od-chat-head strong{font-size:15px}#od-chat-close{border:0;background:transparent;color:#fff;font-size:24px;cursor:pointer}
    #od-chat-log{flex:1;overflow:auto;padding:14px;background:#f7fafb;display:flex;flex-direction:column;gap:10px}
    .od-bubble{max-width:88%;padding:10px 12px;border-radius:13px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}
    .od-bot{align-self:flex-start;background:#fff;border:1px solid #e2e9ec}.od-user{align-self:flex-end;background:#dcefe8}
    #od-chat-actions{padding:12px;border-top:1px solid #e6ecef;display:flex;gap:8px}
    #od-chat-input{min-width:0;flex:1;border:1px solid #d3dfe4;border-radius:10px;padding:11px;font-size:14px}
    #od-chat-send{border:0;border-radius:10px;padding:0 15px;background:#063b52;color:#fff;font-weight:600;cursor:pointer}
    .od-choice{border:1px solid #9cb8c4;border-radius:999px;padding:9px 12px;background:#fff;color:#063b52;cursor:pointer;text-align:left}
    #od-chat-choices{display:flex;flex-wrap:wrap;gap:8px;padding:0 12px 12px;background:#f7fafb}
    #od-chat-status{font-size:12px;color:#667d88;padding:0 14px 8px;background:#f7fafb}
    @media(max-width:480px){#od-chat-panel{right:10px;bottom:75px;width:calc(100vw - 20px);height:70vh}#od-chat-launcher{right:14px;bottom:14px}}
  `;
  document.head.appendChild(style);
  const launcher = document.createElement("button");
  launcher.id = "od-chat-launcher";
  launcher.type = "button";
  launcher.textContent = "💬 Fale conosco";
  const panel = document.createElement("section");
  panel.id = "od-chat-panel";
  panel.setAttribute("aria-label", "Chat de atendimento");
  panel.innerHTML = '<header id="od-chat-head"><strong>Atendimento virtual</strong><button id="od-chat-close" aria-label="Fechar">×</button></header><div id="od-chat-log" aria-live="polite"></div><div id="od-chat-status">Atendimento administrativo</div><div id="od-chat-choices"></div><form id="od-chat-actions"><input id="od-chat-input" autocomplete="name" placeholder="Digite sua mensagem..." maxlength="2000" required><button id="od-chat-send" type="submit">Enviar</button></form>';
  document.body.append(launcher, panel);
  const log = panel.querySelector("#od-chat-log");
  const input = panel.querySelector("#od-chat-input");
  const form = panel.querySelector("#od-chat-actions");
  const choices = panel.querySelector("#od-chat-choices");
  const status = panel.querySelector("#od-chat-status");
  let conversationId = null;
  let sessionToken = null;
  let busy = false;
  let started = false;
  let humanMode = false;
  const seenMessageIds = new Set();
  let pollHandle = null;
  let professionalPhone = "";
  function bubble(text, who) {
    const el = document.createElement("div");
    el.className = "od-bubble " + (who === "user" ? "od-user" : "od-bot");
    el.textContent = String(text || "");
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }
  function setBusy(value) {
    busy = value;
    input.disabled = value;
    panel.querySelector("#od-chat-send").disabled = value;
    choices.querySelectorAll("button").forEach((button) => button.disabled = value);
  }
  async function request(body) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": publishableKey, "Authorization": "Bearer " + publishableKey },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Não foi possível concluir o atendimento.");
    return data;
  }
  function showResult(data) {
    if (data.message) bubble(data.message, "bot");
    if (data.professional_phone) professionalPhone = String(data.professional_phone).replace(/\\D/g, "");
    choices.replaceChildren();
    const oldWhats = panel.querySelector("#od-chat-whatsapp");
    if (oldWhats) oldWhats.remove();
    if (professionalPhone && (data.status === "waiting_human" || data.status === "integration_pending" || data.status === "in_progress")) {
      const wa = document.createElement("a");
      wa.id = "od-chat-whatsapp";
      wa.className = "od-choice";
      wa.style.cssText = "display:block;margin:0 12px 10px;text-decoration:none;text-align:center";
      const normalized = professionalPhone.startsWith("55") ? professionalPhone : "55" + professionalPhone;
      wa.href = "https://wa.me/" + normalized + "?text=" + encodeURIComponent("Olá! Gostaria de continuar meu atendimento pelo OrientaDor.");
      wa.target = "_blank"; wa.rel = "noopener"; wa.textContent = "Continuar pelo WhatsApp";
      panel.insertBefore(wa, form);
    }
    if (Array.isArray(data.choices)) {
      data.choices.forEach((choice) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "od-choice";
        button.textContent = choice.label;
        button.addEventListener("click", () => sendAnswer(choice.value || choice.label));
        choices.appendChild(button);
      });
    }
    if (data.status === "waiting_human" || data.status === "in_progress" || data.status === "integration_pending") { humanMode = true; status.textContent = data.status === "in_progress" ? "Você está conversando com a equipe." : "Aguardando um profissional assumir. Você pode deixar sua mensagem."; }
    else if (data.status === "integration_pending") status.textContent = "Integração pendente · equipe será avisada.";
    else if (data.status === "closed") {
      status.textContent = "Atendimento finalizado.";
      input.disabled = true;
      panel.querySelector("#od-chat-send").disabled = true;
    } else status.textContent = "Atendimento administrativo";
  }
  async function start() {
    if (started || busy) return;
    setBusy(true);
    try {
      const data = await request({ action: "start", chatbot_id: chatbotId });
      conversationId = data.conversation_id;
      sessionToken = data.session_token;
      started = true;
      showResult(data);

    } catch (error) {
      bubble(error.message, "bot");
      status.textContent = "Não foi possível iniciar. Tente novamente mais tarde.";
    } finally { setBusy(false); }
  }
  async function sendAnswer(answer) {
    if (!conversationId || !sessionToken || busy) return;
    const value = String(answer || "").trim();
    if (!value) return;
    bubble(value, "user");
    choices.replaceChildren();
    setBusy(true);
    try {
      if (humanMode) {
        await request({ action: "patient_message", conversation_id: conversationId, session_token: sessionToken, message: value });
        status.textContent = "Mensagem enviada à equipe.";
      } else {
        const data = await request({ action: "reply", conversation_id: conversationId, session_token: sessionToken, answer: value });
        showResult(data);
      }
    } catch (error) { bubble(error.message, "bot"); }
    finally { setBusy(false); }
  }
  async function syncMessages() {
    if (!conversationId || !sessionToken || !panel.classList.contains("od-open")) return;
    try {
      const data = await request({ action: "sync", conversation_id: conversationId, session_token: sessionToken });
      (data.messages || []).forEach((message) => {
        if (seenMessageIds.has(message.id)) return;
        seenMessageIds.add(message.id);
        if (message.sender_type === "professional" || (message.direction === "outbound" && message.sender_type !== "chatbot")) bubble(message.content, "bot");
        else if (message.sender_type === "system") bubble(message.content, "bot");
      });
      if (data.status === "in_progress") { humanMode = true; status.textContent = "Você está conversando com a equipe."; }
      if (data.status === "waiting_human") { humanMode = true; status.textContent = "Aguardando um profissional assumir. Você pode deixar sua mensagem."; }
      if (data.status === "closed") { status.textContent = "Atendimento finalizado."; input.disabled = true; panel.querySelector("#od-chat-send").disabled = true; }
    } catch (error) {
      console.error('OrientaDor chat sync error:', error);
      status.textContent = 'Não foi possível atualizar as mensagens. Reabra o chat ou tente novamente.';
    }
  }
  function openPanel() {
    panel.classList.add("od-open");
    start().then(() => { if (pollHandle) clearInterval(pollHandle); pollHandle = setInterval(syncMessages, 3000); });
  }
  function closePanel() {
    panel.classList.remove("od-open");
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
  }
  launcher.addEventListener("click", () => {
    if (panel.classList.contains("od-open")) closePanel(); else openPanel();
  });
  panel.querySelector("#od-chat-close").addEventListener("click", closePanel);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    input.value = "";
    sendAnswer(value);
  });
})();