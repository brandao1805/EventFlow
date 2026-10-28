"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const html = fs.readFileSync(
  path.join(__dirname, "../public/index.html"),
  "utf8",
);
const script = fs.readFileSync(
  path.join(__dirname, "../public/app.js"),
  "utf8",
);
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};
async function setup(t, logged = false) {
  const calls = [];
  const event = {
    id: "event-test",
    title: "<img src=x onerror=alert(1)>",
    description: "Teste",
    startsAt: "2027-01-10T14:00:00Z",
    category: "Tecnologia",
    city: "São Paulo",
    location: "Auditório",
    companyName: "Organizadora",
    capacity: 10,
    priceCents: 0,
    reserved: 0,
  };
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "http://localhost:3000/",
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  w.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    let status = 200,
      body = {};
    if (url === "/api/me") {
      if (logged)
        body = { id: "u1", name: "Ana Teste", email: "ana@example.com" };
      else {
        status = 401;
        body = { message: "Entre" };
      }
    } else if (url.startsWith("/api/events?"))
      body = { items: [event], cursor: null };
    else if (url === "/api/company") body = null;
    else if (url === "/api/my-events" || url === "/api/registrations")
      body = [];
    else if (url === "/api/login") {
      logged = true;
      body = { id: "u1", name: "Ana Teste", email: "ana@example.com" };
    } else if (url === "/api/users") status = 201;
    return { ok: status < 400, status, json: async () => body };
  };
  w.eval(script);
  await settle();
  return { w, doc: w.document, calls };
}
test("Tela pública renderiza catálogo escapando conteúdo, filtra e abre detalhes", async (t) => {
  const { doc } = await setup(t);
  assert.equal(doc.querySelectorAll("article.card").length, 1);
  assert.equal(doc.querySelectorAll("article img").length, 0);
  assert.match(doc.querySelector("article h3").textContent, /<img/);
  doc.querySelector("[data-detail]").click();
  assert.equal(doc.querySelector("dialog").open, true);
  assert.match(doc.querySelector("#register-event").textContent, /Entrar/);
  doc.querySelector("#close-modal").click();
  const search = doc.querySelector("#search");
  search.value = "Não existe";
  search.dispatchEvent(new doc.defaultView.Event("input"));
  assert.equal(doc.querySelectorAll("article.card").length, 0);
});
test("Visitante é convidado a entrar e pode enviar formulário de cadastro", async (t) => {
  const { w, doc, calls } = await setup(t);
  doc.querySelector('[data-view="organize"]').click();
  await settle();
  assert.ok(doc.querySelector("#need-login"));
  doc.querySelector("#need-login").click();
  doc.querySelector("#switch-auth").click();
  doc.querySelector("[name=name]").value = "Ana Teste";
  doc.querySelector("[name=email]").value = "ana@example.com";
  doc.querySelector("[name=password]").value = "Senha123!";
  doc
    .querySelector("form")
    .dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  await settle();
  assert.ok(
    calls.some((c) => c.url === "/api/users" && c.opts.method === "POST"),
  );
  assert.ok(calls.some((c) => c.url === "/api/login"));
  assert.equal(doc.querySelector("dialog").open, false);
  assert.ok(doc.querySelector("#new-company"));
});
test("Organizador abre perfil de empresa e monta documento com endereço e tags", async (t) => {
  const { w, doc, calls } = await setup(t, true);
  doc.querySelector('[data-view="organize"]').click();
  await settle();
  doc.querySelector("#new-company").click();
  for (const [k, v] of Object.entries({
    name: "Empresa",
    cnpj: "12345678000190",
    city: "São Paulo",
    tags: "Cursos, Tecnologia",
  }))
    doc.querySelector(`[name=${k}]`).value = v;
  doc
    .querySelector("form")
    .dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  await settle();
  const c = calls.find(
    (c) => c.url === "/api/company" && c.opts.method === "POST",
  );
  assert.ok(c);
  const data = JSON.parse(c.opts.body);
  assert.equal(data.address.city, "São Paulo");
  assert.deepEqual(data.tags, ["Cursos", "Tecnologia"]);
});
