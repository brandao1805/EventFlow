"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const V = require("../src/validation");
const S = require("../src/security");
const { transaction, makePublisher } = require("../src/stores");
const { createApp } = require("../src/app");
const validEvent = () => ({
  title: "Encontro",
  startsAt: new Date(Date.now() + 86400000).toISOString(),
  capacity: 10,
  priceCents: 1990,
  location: "Auditório",
  city: "São Paulo",
});
test("Evento normaliza UTC, preserva centavos e recusa capacidade fracionária", () => {
  const e = V.event(validEvent());
  assert.equal(e.month, e.startsAt.slice(0, 7));
  assert.equal(e.priceCents, 1990);
  assert.throws(
    () => V.event({ ...validEvent(), capacity: 1.5 }),
    /Capacidade/,
  );
  assert.throws(() => V.event({ ...validEvent(), priceCents: 1.2 }), /Preço/);
});
test("Evento recusa passado, data inválida e campos vazios", () => {
  for (const startsAt of ["inválida", "2020-01-01T00:00:00Z"])
    assert.throws(() => V.event({ ...validEvent(), startsAt }), V.ApiError);
  assert.throws(() => V.event({ ...validEvent(), title: " " }), /Título/);
});
test("Cadastro normaliza e-mail e não aceita senha curta", () => {
  assert.equal(
    V.user({ name: " Ana ", email: "ANA@EXAMPLE.COM", password: "Senha123!" })
      .email,
    "ana@example.com",
  );
  assert.throws(
    () => V.user({ name: "Ana", email: "ana@example.com", password: "123" }),
    /Senha/,
  );
});
test("Documento tem endereço embarcado e especialidades limitadas", () => {
  const doc = V.company({
    name: "Organizadora",
    cnpj: "12.345.678/0001-90",
    address: { city: "São Paulo" },
    tags: ["Cursos"],
  });
  assert.equal(doc.cnpj, "12345678000190");
  assert.equal(doc.address.city, "São Paulo");
  assert.throws(() => V.company({ ...doc, tags: Array(11).fill("x") }), /10/);
});
test("Validação de mês rejeita injeção e mês fora do intervalo", () => {
  assert.equal(V.month("2027-01"), "2027-01");
  assert.throws(() => V.month("2027-13"));
  assert.throws(() => V.month("2027-01' OR 1=1"));
});
test("Senhas usam salts diferentes e comparação segura", async () => {
  const a = await S.hashPassword("Teste123!");
  const b = await S.hashPassword("Teste123!");
  assert.notEqual(a, b);
  assert.ok(await S.verifyPassword("Teste123!", a));
  assert.equal(await S.verifyPassword("errada", a), false);
  assert.ok(!a.includes("Teste123!"));
});
test("Transação confirma sucesso e reverte falha, sempre liberando conexão", async () => {
  let actions = [];
  const conn = {
    beginTransaction: async () => actions.push("begin"),
    commit: async () => actions.push("commit"),
    rollback: async () => actions.push("rollback"),
    release: () => actions.push("release"),
  };
  const sql = { getConnection: async () => conn };
  assert.equal(await transaction(sql, async () => 42), 42);
  assert.deepEqual(actions, ["begin", "commit", "release"]);
  actions = [];
  await assert.rejects(
    transaction(sql, async () => {
      throw Error("falha");
    }),
  );
  assert.deepEqual(actions, ["begin", "rollback", "release"]);
});
function publisherFixture(job, failOnce = false) {
  let pending = true,
    batches = [],
    rollbacks = 0,
    commits = 0;
  const conn = {
    beginTransaction: async () => {},
    query: async () => [
      pending ? [{ id: 1, event_id: "event-1", payload: job }] : [],
    ],
    execute: async (q) => {
      if (q.startsWith("DELETE FROM outbox")) pending = false;
      return [{}];
    },
    commit: async () => {
      commits++;
    },
    rollback: async () => {
      rollbacks++;
    },
    release: () => {},
  };
  const stores = {
    sql: { getConnection: async () => conn },
    cql: {
      batch: async (ops) => {
        if (failOnce) {
          failOnce = false;
          throw Error("Cassandra offline");
        }
        batches.push(ops);
      },
    },
  };
  return {
    publish: makePublisher(stores),
    batches,
    get pending() {
      return pending;
    },
    get rollbacks() {
      return rollbacks;
    },
    get commits() {
      return commits;
    },
  };
}
test("Outbox mantém tarefa após falha do Cassandra e publica na próxima tentativa", async () => {
  const f = publisherFixture(
    { event: { id: "event-1", month: "2027-01", startsAt: "2027-01-20" } },
    true,
  );
  await assert.rejects(f.publish(), /offline/);
  assert.equal(f.pending, true);
  assert.equal(f.rollbacks, 1);
  await f.publish();
  assert.equal(f.pending, false);
  assert.equal(f.batches.length, 1);
  assert.equal(f.batches[0].length, 2);
});
test("Edição sem troca de chave não gera tombstone sobre a nova linha", async () => {
  const event = { id: "event-1", month: "2027-01", startsAt: "2027-01-20" };
  const f = publisherFixture({
    event: { ...event, title: "Novo título" },
    previous: event,
  });
  await f.publish();
  assert.equal(
    f.batches[0].filter((q) => q.query.startsWith("DELETE")).length,
    0,
  );
});
test("Mudança de mês remove a projeção antiga e cria a nova", async () => {
  const f = publisherFixture({
    event: { id: "event-1", month: "2027-02", startsAt: "2027-02-20" },
    previous: { month: "2027-01", startsAt: "2027-01-20" },
  });
  await f.publish();
  assert.equal(f.batches[0].length, 3);
  assert.deepEqual(f.batches[0][0].params, [
    "2027-01",
    "2027-01-20",
    "event-1",
  ]);
});
test("Exclusão publica remoção nas duas tabelas Cassandra", async () => {
  const f = publisherFixture({
    remove: true,
    previous: { month: "2027-01", startsAt: "2027-01-20" },
  });
  await f.publish();
  assert.equal(f.batches[0].length, 2);
  assert.ok(f.batches[0].every((q) => q.query.startsWith("DELETE")));
});
test("HTTP protege mutações cross-site e rotas privadas, valida JSON", async (t) => {
  const server = createApp({ sql: {}, companies: {}, cql: {} }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = "http://127.0.0.1:" + server.address().port;
  const forbidden = await fetch(base + "/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(forbidden.status, 403);
  const privateResponse = await fetch(base + "/api/me");
  assert.equal(privateResponse.status, 401);
  const invalid = await fetch(base + "/api/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "EventFlow",
    },
    body: "{",
  });
  assert.equal(invalid.status, 400);
  const html = await fetch(base + "/");
  assert.equal(html.status, 200);
  assert.match(
    html.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.match(await html.text(), /EventFlow/);
});
