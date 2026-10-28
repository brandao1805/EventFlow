"use strict";
const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let me = null,
  view = "explore",
  items = [],
  myEvents = [],
  company = null,
  cursor = null,
  selectedMonth = new Date().toISOString().slice(0, 7);
const money = (n) =>
  n === 0
    ? "Gratuito"
    : (n / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (s) =>
  new Date(s).toLocaleString("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
async function api(url, method = "GET", data) {
  const r = await fetch("/api" + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "EventFlow",
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.message || "Não foi possível concluir.");
  return body;
}
function notice(message, error = false) {
  $("#notice").textContent = message;
  $("#notice").className = error ? "error" : "";
}
function account() {
  $("#account").innerHTML = me
    ? `<button class="text-button" id="profile-button">${esc(me.name.split(" ")[0])} ↗</button><button class="secondary" id="logout">Sair</button>`
    : '<button class="secondary" id="login">Entrar</button>';
  if (me) {
    $("#profile-button").onclick = () => navigate("profile");
    $("#logout").onclick = async () => {
      try {
        await api("/logout", "POST");
        me = null;
        account();
        await navigate("explore");
      } catch (e) {
        notice(e.message, true);
      }
    };
  } else $("#login").onclick = () => authModal(false);
}
function openModal(title, html) {
  $("#modal-title").textContent = title;
  $("#modal-content").innerHTML = html;
  if (!$("#modal").open) $("#modal").showModal();
}
$("#close-modal").onclick = () => $("#modal").close();
function bindForm(handler) {
  $("#modal form").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.target.querySelector("[type=submit]");
    button.disabled = true;
    try {
      await handler(Object.fromEntries(new FormData(e.target)));
    } catch (err) {
      $("#modal .form-error").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
}
const field = (name, label, value = "", type = "text", extra = "") =>
  `<label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}>`;
function authModal(signup) {
  openModal(
    signup ? "Crie sua conta" : "Bem-vindo de volta",
    `<p class="subtle">Sua próxima experiência está a um passo.</p><form>${signup ? field("name", "Nome", "", "text", 'required maxlength="100"') : ""}${field("email", "E-mail", "", "email", 'required maxlength="180" autocomplete="email"')}${field("password", "Senha", "", "password", `required minlength="${signup ? 8 : 1}" maxlength="128" autocomplete="${signup ? "new-password" : "current-password"}"`)}<div class="form-error" role="alert"></div><div class="actions"><button class="primary" type="submit">${signup ? "Cadastrar e entrar" : "Entrar"}</button><button class="text-button" type="button" id="switch-auth">${signup ? "Já tenho conta" : "Criar uma conta"}</button></div></form>`,
  );
  $("#switch-auth").onclick = () => authModal(!signup);
  bindForm(async (b) => {
    if (signup) await api("/users", "POST", b);
    me = await api("/login", "POST", b);
    account();
    $("#modal").close();
    notice("Bem-vindo, " + me.name + "!");
    await navigate(view);
  });
}
async function navigate(next) {
  view = next;
  document
    .querySelectorAll("[data-view]")
    .forEach((el) => el.classList.toggle("active", el.dataset.view === view));
  $("#content").innerHTML = '<p class="subtle">Carregando…</p>';
  try {
    if (view !== "explore" && !me) {
      $("#content").innerHTML = empty(
        "Seu espaço no EventFlow",
        "Entre para gerenciar suas inscrições, perfil e eventos.",
        "Entrar",
        "need-login",
      );
      $("#need-login").onclick = () => authModal(false);
      return;
    }
    if (view === "explore") await explore();
    if (view === "organize") await organize();
    if (view === "tickets") await tickets();
    if (view === "profile") profile();
  } catch (e) {
    $("#content").innerHTML = empty(
      "Não foi possível carregar",
      e.message,
      "Tentar novamente",
      "retry",
    );
    $("#retry").onclick = () => navigate(view);
    notice(e.message, true);
  }
}
document
  .querySelectorAll("[data-view]")
  .forEach((el) => (el.onclick = () => navigate(el.dataset.view)));
$("#hero-organize").onclick = () => navigate("organize");
function empty(title, description, button, id) {
  return `<div class="empty"><span class="empty-symbol">✳</span><h3>${esc(title)}</h3><p>${esc(description)}</p>${button ? `<button class="primary" id="${id}">${esc(button)}</button>` : ""}</div>`;
}
function card(ev, owner = false) {
  const d = new Date(ev.startsAt);
  return `<article class="card"><div class="card-art"><span class="date-chip"><b>${d.getDate()}</b>${esc(d.toLocaleString("pt-BR", { month: "short" }).toUpperCase())}</span><span class="art-word" aria-hidden="true">${esc(ev.category.slice(0, 3).toUpperCase())}</span></div><div class="card-body"><span class="tag">${esc(ev.category)}</span><h3>${esc(ev.title)}</h3><p>${esc(ev.city)} · ${esc(ev.location)}</p><p>${esc(date(ev.startsAt))}</p><p>${esc(ev.companyName)} · ${ev.reserved || 0}/${ev.capacity} inscritos</p>${ev.pending ? `<p class="pending">${ev.deleting ? "Exclusão" : "Publicação"} em processamento…</p>` : ""}<div class="card-foot"><strong>${money(ev.priceCents)}</strong>${owner ? `<div><button class="secondary" data-edit="${ev.id}" ${ev.pending ? "disabled" : ""}>Editar</button> <button class="text-button" data-delete="${ev.id}" ${ev.pending ? "disabled" : ""}>Excluir</button></div>` : `<button class="secondary" data-detail="${ev.id}">Ver evento ↗</button>`}</div></div></article>`;
}
async function explore() {
  const result = await api("/events?month=" + selectedMonth);
  items = result.items;
  cursor = result.cursor;
  $("#content").innerHTML =
    `<div class="section-head"><div><h2>Encontre sua próxima experiência</h2><p class="subtle">Explore a agenda do mês e escolha seu próximo encontro.</p></div><div class="filters"><input aria-label="Pesquisar eventos carregados" id="search" placeholder="Buscar nesta página…"><input aria-label="Mês dos eventos" id="month" type="month" value="${selectedMonth}"></div></div><div id="event-grid" class="grid"></div><button id="load-more" class="secondary more">Carregar mais</button>`;
  $("#month").onchange = () => {
    selectedMonth = $("#month").value;
    if (selectedMonth) navigate("explore");
  };
  $("#search").oninput = drawEvents;
  $("#load-more").onclick = async () => {
    try {
      const r = await api(
        "/events?month=" +
          selectedMonth +
          "&cursor=" +
          encodeURIComponent(cursor),
      );
      items.push(...r.items);
      cursor = r.cursor;
      drawEvents();
    } catch (e) {
      notice(e.message, true);
    }
  };
  drawEvents();
}
function drawEvents() {
  const term = $("#search").value.toLowerCase();
  const filtered = items.filter((e) =>
    (e.title + " " + e.city + " " + e.category).toLowerCase().includes(term),
  );
  $("#event-grid").innerHTML =
    filtered.map((e) => card(e)).join("") ||
    empty(
      "A agenda está aberta",
      "Nenhum evento encontrado neste mês. Escolha outro mês ou crie o primeiro.",
    );
  $("#load-more").hidden = !cursor;
  document
    .querySelectorAll("[data-detail]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          detail(items.find((e) => e.id === b.dataset.detail))),
    );
}
function detail(ev) {
  openModal(
    ev.title,
    `<p class="tag">${esc(ev.category)} · ${esc(ev.companyName)}</p><p class="detail-text">${esc(ev.description || "O organizador ainda não adicionou uma descrição.")}</p><p><strong>Quando:</strong> ${esc(date(ev.startsAt))}</p><p><strong>Onde:</strong> ${esc(ev.location)} · ${esc(ev.city)}</p><p><strong>Ingresso:</strong> ${money(ev.priceCents)}</p><p class="subtle">${Math.max(0, ev.capacity - (ev.reserved || 0))} vagas disponíveis. A inscrição não realiza cobrança.</p><div class="actions"><button id="register-event" class="primary">${me ? "Confirmar inscrição" : "Entrar para participar"}</button></div><div class="form-error" role="alert"></div>`,
  );
  $("#register-event").onclick = async () => {
    if (!me) return authModal(false);
    const b = $("#register-event");
    b.disabled = true;
    try {
      await api("/events/" + ev.id + "/registrations", "POST");
      $("#modal").close();
      notice("Inscrição confirmada! Veja em Minhas inscrições.");
      await navigate(view);
    } catch (e) {
      $("#modal .form-error").textContent = e.message;
    } finally {
      b.disabled = false;
    }
  };
}
async function organize() {
  [company, myEvents] = await Promise.all([api("/company"), api("/my-events")]);
  $("#content").innerHTML =
    `<div class="section-head"><div><h2>${company ? esc(company.name) : "Dê vida ao seu próximo evento"}</h2><p class="subtle">${company ? "Seu espaço de organização. Acompanhe e atualize sua agenda." : "Primeiro, cadastre o perfil da sua empresa organizadora."}</p></div><div class="actions">${company ? '<button id="edit-company" class="secondary">Editar empresa</button><button id="new-event" class="primary">+ Criar evento</button>' : '<button id="new-company" class="primary">Cadastrar empresa</button>'}</div></div><div class="grid">${myEvents.map((e) => card(e, true)).join("") || empty("Comece uma nova história", "Seus eventos aparecerão aqui.")}</div>${company ? '<div class="actions"><button id="delete-company" class="text-button">Excluir empresa</button><button id="refresh-events" class="secondary">Atualizar publicações</button></div>' : ""}`;
  if (company) {
    $("#edit-company").onclick = companyForm;
    $("#new-event").onclick = () => eventForm();
    $("#refresh-events").onclick = () => navigate("organize");
    $("#delete-company").onclick = () =>
      confirmAction(
        "Excluir empresa?",
        "Você só poderá excluir uma empresa sem eventos.",
        async () => {
          await api("/company", "DELETE");
          await navigate("organize");
        },
      );
  } else $("#new-company").onclick = companyForm;
  document
    .querySelectorAll("[data-edit]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          eventForm(myEvents.find((e) => e.id === b.dataset.edit))),
    );
  document.querySelectorAll("[data-delete]").forEach(
    (b) =>
      (b.onclick = () =>
        confirmAction(
          "Excluir evento?",
          "Eventos com inscrições precisam ter as inscrições canceladas primeiro.",
          async () => {
            const r = await api("/events/" + b.dataset.delete, "DELETE");
            notice(r.message);
            await navigate("organize");
          },
        )),
  );
}
function companyForm() {
  const c = company || {};
  openModal(
    company ? "Editar empresa" : "Cadastre sua empresa",
    `<form><div class="cols"><div>${field("name", "Nome da empresa", c.name, "text", 'required maxlength="100"')}</div><div>${field("cnpj", "CNPJ (14 dígitos)", c.cnpj, "text", 'required maxlength="18"')}</div><div>${field("city", "Cidade", c.address?.city, "text", 'required maxlength="100"')}</div><div>${field("contact", "Contato", c.contact, "text", 'maxlength="180"')}</div><div class="full">${field("street", "Endereço", c.address?.street, "text", 'maxlength="200"')}${field("tags", "Especialidades (separadas por vírgula)", c.tags?.join(", "), "text", 'maxlength="400"')}<label for="description">Sobre a empresa</label><textarea id="description" name="description" maxlength="1000">${esc(c.description)}</textarea></div></div><div class="form-error" role="alert"></div><div class="actions"><button type="submit" class="primary">Salvar empresa</button></div></form>`,
  );
  bindForm(async (b) => {
    await api("/company", company ? "PUT" : "POST", {
      ...b,
      address: { city: b.city, street: b.street },
      tags: b.tags
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    });
    $("#modal").close();
    notice("Empresa salva.");
    await navigate("organize");
  });
}
function localDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function eventForm(ev) {
  const e = ev || {};
  openModal(
    ev ? "Editar evento" : "Crie um novo encontro",
    `<form><div class="cols"><div class="full">${field("title", "Título do evento", e.title, "text", 'required maxlength="120"')}</div><div>${field("startsAt", "Data e horário local", localDate(e.startsAt), "datetime-local", "required")}</div><div>${field("category", "Categoria", e.category || "Tecnologia", "text", 'required maxlength="50"')}</div><div>${field("city", "Cidade", e.city || company.address.city, "text", 'required maxlength="100"')}</div><div>${field("location", "Local / endereço", e.location, "text", 'required maxlength="200"')}</div><div>${field("capacity", "Número de vagas", e.capacity || 50, "number", 'required min="1" max="100000" step="1"')}</div><div>${field("price", "Valor em R$ (0 = gratuito)", ((e.priceCents || 0) / 100).toFixed(2), "number", 'required min="0" max="1000000" step="0.01"')}</div><div class="full"><label for="description">Descrição</label><textarea id="description" name="description" maxlength="2000">${esc(e.description)}</textarea></div></div><p class="subtle">Datas são armazenadas em UTC e exibidas no fuso do navegador. Valores são informativos; não há pagamento online.</p><div class="form-error" role="alert"></div><div class="actions"><button class="primary" type="submit">Salvar e publicar</button></div></form>`,
  );
  bindForm(async (b) => {
    const r = await api(
      ev ? "/events/" + ev.id : "/events",
      ev ? "PUT" : "POST",
      {
        ...b,
        startsAt: new Date(b.startsAt).toISOString(),
        capacity: Number(b.capacity),
        priceCents: Math.round(Number(b.price) * 100),
      },
    );
    $("#modal").close();
    notice(r.message);
    await navigate("organize");
  });
}
function confirmAction(title, description, fn) {
  openModal(
    title,
    `<p>${esc(description)}</p><form><div class="form-error" role="alert"></div><div class="actions"><button class="danger" type="submit">Confirmar exclusão</button></div></form>`,
  );
  bindForm(async () => {
    await fn();
    $("#modal").close();
  });
}
async function tickets() {
  const rows = await api("/registrations");
  $("#content").innerHTML =
    `<div class="section-head"><div><h2>Seus próximos encontros</h2><p class="subtle">Inscrições confirmadas e observações pessoais.</p></div></div><div class="grid">${rows.map((r) => `<article class="card"><div class="card-body"><span class="tag">INSCRIÇÃO CONFIRMADA</span><h3>${esc(r.event?.title || "Evento indisponível")}</h3><p>${r.event ? esc(date(r.event.startsAt)) : ""}</p><p>${esc(r.event?.location)} · ${esc(r.event?.city)}</p><p class="detail-text">${esc(r.note || "Nenhuma observação pessoal.")}</p><div class="actions"><button class="secondary" data-note="${r.event_id}">Editar observação</button><button class="text-button" data-cancel="${r.event_id}">Cancelar inscrição</button></div></div></article>`).join("") || empty("Encontre algo que combine com você", "Explore a agenda e confirme sua primeira inscrição.")}</div>`;
  document.querySelectorAll("[data-note]").forEach(
    (b) =>
      (b.onclick = () => {
        const r = rows.find((r) => r.event_id === b.dataset.note);
        openModal(
          "Observação da inscrição",
          `<form><label for="note">Sua observação pessoal</label><textarea id="note" name="note" maxlength="200">${esc(r.note)}</textarea><div class="form-error" role="alert"></div><div class="actions"><button class="primary" type="submit">Salvar</button></div></form>`,
        );
        bindForm(async (data) => {
          await api("/registrations/" + r.event_id, "PUT", data);
          $("#modal").close();
          await tickets();
        });
      }),
  );
  document.querySelectorAll("[data-cancel]").forEach(
    (b) =>
      (b.onclick = () =>
        confirmAction(
          "Cancelar inscrição?",
          "Sua vaga será liberada para outra pessoa.",
          async () => {
            await api("/registrations/" + b.dataset.cancel, "DELETE");
            notice("Inscrição cancelada.");
            await tickets();
          },
        )),
  );
}
function profile() {
  $("#content").innerHTML =
    `<div class="section-head"><div><h2>Minha conta</h2><p class="subtle">Seus dados e preferências de acesso.</p></div></div><div class="panel"><h3>${esc(me.name)}</h3><p>${esc(me.email)}</p><div class="actions"><button id="edit-profile" class="primary">Editar meus dados</button><button id="delete-profile" class="danger">Excluir conta</button></div></div>`;
  $("#edit-profile").onclick = () => {
    openModal(
      "Editar meus dados",
      `<form>${field("name", "Nome", me.name, "text", 'required maxlength="100"')}${field("email", "E-mail", me.email, "email", 'required maxlength="180"')}${field("password", "Nova senha (deixe em branco para manter)", "", "password", 'minlength="8" maxlength="128" autocomplete="new-password"')}<div class="form-error" role="alert"></div><div class="actions"><button class="primary" type="submit">Salvar</button></div></form>`,
    );
    bindForm(async (b) => {
      me = await api("/me", "PUT", b);
      account();
      $("#modal").close();
      profile();
      notice("Perfil atualizado.");
    });
  };
  $("#delete-profile").onclick = () =>
    confirmAction(
      "Excluir sua conta?",
      "Cancele as inscrições e exclua seus eventos e sua empresa antes de continuar. A exclusão é definitiva.",
      async () => {
        await api("/me", "DELETE");
        me = null;
        account();
        notice("Conta excluída.");
        await navigate("explore");
      },
    );
}
$("#health").onclick = async () => {
  try {
    const r = await api("/health");
    notice(
      Object.entries(r.databases)
        .map(([k, v]) => k + ": " + v)
        .join(" · "),
    );
  } catch (e) {
    notice(e.message, true);
  }
};
setInterval(() => {
  if (
    view === "organize" &&
    !$("#modal").open &&
    myEvents.some((e) => e.pending)
  )
    navigate("organize");
}, 4000);
(async () => {
  try {
    me = await api("/me");
  } catch {}
  account();
  await navigate("explore");
})();
