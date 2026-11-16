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
    #od-chat-launcher{position:fixed;right:24px;bottom:24px;z-index:2147483000;border:0;border-radius:999px;padding:15px 21px;background:#01355E;color:#fff;font:700 14px Inter,Arial,sans-serif;box-shadow:0 10px 30px #01355e35;cursor:pointer;transition:transform .2s,box-shadow .2s}
    #od-chat-launcher:hover{transform:translateY(-2px);box-shadow:0 14px 34px #01355e45}
    #od-chat-panel{position:fixed;right:24px;bottom:88px;z-index:2147483000;width:min(390px,calc(100vw - 32px));height:min(620px,calc(100vh - 120px));background:#fff;border:1px solid #dce7ef;border-radius:22px;box-shadow:0 22px 65px #0c2c4530;display:none;overflow:hidden;font:14px Inter,ui-sans-serif,Arial,sans-serif;color:#183342}
    #od-chat-panel.od-open{display:flex;flex-direction:column}
    #od-chat-head{padding:18px 18px 16px;background:linear-gradient(135deg,#01355E,#0c527f);color:#fff;display:flex;justify-content:space-between;align-items:center;gap:12px;box-shadow:0 3px 12px #01355e20}
    #od-chat-head .od-brand{display:flex;align-items:center;gap:11px;min-width:0}
    #od-chat-head .od-mark{width:42px;height:42px;flex:0 0 42px;border-radius:50%;background:#ffffff1c;border:1px solid #ffffff55;display:grid;place-items:center;font-size:17px;font-weight:800;overflow:hidden}#od-chat-head .od-mark img{width:100%;height:100%;object-fit:cover;display:block}
    #od-chat-head strong{display:block;font-size:14px;letter-spacing:.01em}
    #od-chat-head small{display:block;margin-top:4px;font-size:11px;color:#d5e5f1}
    #od-chat-close{width:34px;height:34px;border:0;border-radius:10px;background:#ffffff18;color:#fff;font-size:23px;line-height:1;cursor:pointer}
    #od-chat-close:hover{background:#ffffff2b}
    #od-chat-log{flex:1;overflow:auto;padding:18px 14px;background:#f5f8fb;display:flex;flex-direction:column;gap:11px;scroll-behavior:smooth}
    .od-bubble{max-width:88%;padding:12px 14px;border-radius:16px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;box-shadow:0 2px 8px #18334208}
    .od-bot{align-self:flex-start;background:#fff;border:1px solid #e4ebf1;border-bottom-left-radius:5px;color:#263f50}
    .od-user{align-self:flex-end;background:#e4effa;border:1px solid #d5e5f5;border-bottom-right-radius:5px;color:#123c60}
    #od-chat-status{display:none!important}
    #od-chat-status:before{content:"";width:7px;height:7px;border-radius:50%;background:#23a477;display:inline-block;flex:0 0 7px}
    #od-chat-choices{display:flex;flex-wrap:wrap;gap:8px;padding:4px 14px 14px;background:#fff}
    .od-choice{border:1px solid #cbdceb;border-radius:12px;padding:10px 13px;background:#fff;color:#01355E;cursor:pointer;text-align:left;font:600 12px Inter,Arial,sans-serif;transition:background .15s,border-color .15s,transform .15s}
    .od-choice:hover{background:#edf4fb;border-color:#83a9ca;transform:translateY(-1px)}
    .od-choice:focus-visible,#od-chat-send:focus-visible,#od-chat-close:focus-visible{outline:3px solid #8bbce3;outline-offset:2px}
    #od-chat-actions{padding:12px 14px 14px;border-top:1px solid #e8eef3;background:#fff;display:flex;gap:9px;align-items:center}
    #od-chat-input{min-width:0;flex:1;border:1px solid #d8e2ea;border-radius:13px;padding:12px 13px;font:13px Inter,Arial,sans-serif;color:#183342;background:#f9fbfd;outline:none;transition:border-color .15s,box-shadow .15s}
    #od-chat-input:focus{border-color:#6c9fc8;box-shadow:0 0 0 3px #e5f0f9;background:#fff}
    #od-chat-input:disabled{background:#f0f3f6}
    #od-chat-send{border:0;border-radius:12px;padding:0 17px;min-height:42px;background:#01355E;color:#fff;font:700 12px Inter,Arial,sans-serif;cursor:pointer;transition:background .15s}
    #od-chat-send:hover{background:#0b527f}#od-chat-send:disabled{opacity:.55;cursor:wait}
    @media(max-width:600px){#od-chat-panel{right:10px;bottom:78px;width:calc(100vw - 20px);height:min(72vh,640px);border-radius:20px}#od-chat-launcher{right:14px;bottom:14px;padding:14px 18px}#od-chat-log{padding:14px 11px}}
    @media(prefers-reduced-motion:reduce){#od-chat-launcher,.od-choice{transition:none}#od-chat-log{scroll-behavior:auto}}
  `;
  document.head.appendChild(style);
  const launcher = document.createElement("button");
  launcher.id = "od-chat-launcher";
  launcher.type = "button";
  launcher.textContent = "💬 Fale conosco";
  const panel = document.createElement("section");
  panel.id = "od-chat-panel";
  panel.setAttribute("aria-label", "Chat de atendimento");
  panel.innerHTML = '<header id="od-chat-head"><div class="od-brand"><div class="od-mark" id="od-chat-avatar" aria-hidden="true">O</div><div><strong id="od-chat-professional-name">OrientaDor</strong><small>Estamos aqui para ajudar você</small></div></div><button id="od-chat-close" aria-label="Fechar">×</button></header><div id="od-chat-log" aria-live="polite"></div><div id="od-chat-status">Atendimento online</div><div id="od-chat-choices"></div><form id="od-chat-actions"><input id="od-chat-input" autocomplete="name" placeholder="Digite sua mensagem..." maxlength="2000" required><button id="od-chat-send" type="submit">Enviar</button></form>';
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
    const value = String(text || "");
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    let cursor = 0;
    let match;
    while ((match = urlPattern.exec(value)) !== null) {
      el.appendChild(document.createTextNode(value.slice(cursor, match.index)));
      const link = document.createElement("a");
      link.href = match[0].replace(/[),.]+$/, "");
      link.textContent = link.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.style.cssText = "color:#075b91;text-decoration:underline;overflow-wrap:anywhere";
      el.appendChild(link);
      cursor = match.index + match[0].length;
    }
    el.appendChild(document.createTextNode(value.slice(cursor)));
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
    if (data.professional_avatar_url) {
      const avatar = panel.querySelector("#od-chat-avatar");
      if (avatar) avatar.innerHTML = '<img src="' + String(data.professional_avatar_url).replace(/"/g, "&quot;") + '" alt="">';
    }
    if (data.professional_name) {
      const name = panel.querySelector("#od-chat-professional-name");
      if (name) name.textContent = data.professional_name;
    }
    if (Array.isArray(data.preceding_messages)) data.preceding_messages.forEach((message) => bubble(message, "bot"));
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
        button.addEventListener("click", () => sendAnswer(choice.value || choice.label, choice.label));
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
  async function sendAnswer(answer, displayText) {
    if (!conversationId || !sessionToken || busy) return;
    const value = String(answer || "").trim();
    if (!value) return;
    bubble(displayText || value, "user");
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