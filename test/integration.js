"use strict";
// Executar contra os TRÊS bancos reais: docker compose exec app npm run test:integration
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const base = process.env.BASE_URL || "http://localhost:3000";
const suffix = randomUUID().slice(0, 8);
const future = new Date(Date.now() + 7 * 86400000).toISOString();
const users = [];
let eventId,
  companyCreated = false;
async function request(path, method = "GET", data, session) {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "EventFlow",
      ...(session ? { Cookie: session.cookie } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await r.json();
  return {
    status: r.status,
    body,
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
async function expect(path, method, data, session, status) {
  const r = await request(path, method, data, session);
  assert.equal(
    r.status,
    status,
    `${method} ${path}: ${JSON.stringify(r.body)}`,
  );
  return r;
}
async function waitFor(fn) {
  for (let i = 0; i < 45; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error("Sincronização não concluiu em 45 segundos.");
}
async function synced() {
  const r = await expect("/my-events", "GET", undefined, users[0], 200);
  return r.body.some((e) => e.id === eventId && !e.pending);
}
async function main() {
  assert.equal(
    (await request("/health")).status,
    200,
    "Os três bancos devem estar online.",
  );
  for (let i = 0; i < 3; i++) {
    const email = `teste-${suffix}-${i}@example.com`;
    await expect(
      "/users",
      "POST",
      { name: `Teste ${i}`, email, password: "Teste123!" },
      null,
      201,
    );
    const login = await expect(
      "/login",
      "POST",
      { email, password: "Teste123!" },
      null,
      200,
    );
    users.push({ cookie: login.cookie, email });
  }
  const owner = users[0];
  await expect(
    "/company",
    "POST",
    {
      name: "Empresa de Teste",
      cnpj: String(Date.now()).padStart(14, "0"),
      address: { city: "São Paulo" },
      tags: ["Tecnologia"],
    },
    owner,
    201,
  );
  companyCreated = true;
  await expect(
    "/company",
    "PUT",
    {
      name: "Empresa Atualizada",
      cnpj: String(Date.now()).padStart(14, "0"),
      address: { city: "Santo André" },
      tags: ["Cursos"],
    },
    owner,
    200,
  );
  const data = {
    title: "Teste integrado " + suffix,
    description: "Evento temporário do teste",
    startsAt: future,
    capacity: 1,
    priceCents: 0,
    city: "Santo André",
    location: "Laboratório",
    category: "Tecnologia",
  };
  eventId = (await expect("/events", "POST", data, owner, 202)).body.id;
  await waitFor(synced);
  const list = await expect(
    "/events?month=" + future.slice(0, 7),
    "GET",
    undefined,
    null,
    200,
  );
  assert.ok(list.body.items.some((e) => e.id === eventId));
  await expect("/events/" + eventId, "PUT", data, users[1], 403);
  const race = await Promise.all(
    users
      .slice(1)
      .map((u) =>
        request("/events/" + eventId + "/registrations", "POST", undefined, u),
      ),
  );
  assert.deepEqual(
    race.map((r) => r.status).sort(),
    [201, 409],
    "A última vaga só pode ser ocupada uma vez",
  );
  const winner = users[1 + race.findIndex((r) => r.status === 201)];
  await expect(
    "/events/" + eventId + "/registrations",
    "POST",
    undefined,
    winner,
    409,
  );
  await expect(
    "/registrations/" + eventId,
    "PUT",
    { note: "Levar documento" },
    winner,
    200,
  );
  const registrations = await expect(
    "/registrations",
    "GET",
    undefined,
    winner,
    200,
  );
  assert.equal(
    registrations.body.find((r) => r.event_id === eventId).note,
    "Levar documento",
  );
  await expect("/events/" + eventId, "DELETE", undefined, owner, 409);
  await expect("/company", "DELETE", undefined, owner, 409);
  await expect(
    "/events/" + eventId,
    "PUT",
    { ...data, title: "Título atualizado", capacity: 2 },
    owner,
    202,
  );
  await waitFor(synced);
  const edited = await expect(
    "/events?month=" + future.slice(0, 7),
    "GET",
    undefined,
    null,
    200,
  );
  assert.equal(
    edited.body.items.find((e) => e.id === eventId).title,
    "Título atualizado",
  );
  await expect(
    "/me",
    "PUT",
    { name: "Participante atualizado", email: winner.email },
    winner,
    200,
  );
  await expect("/registrations/" + eventId, "DELETE", undefined, winner, 200);
  await expect("/events/" + eventId, "DELETE", undefined, owner, 202);
  await waitFor(
    async () =>
      !(await request("/my-events", "GET", undefined, owner)).body.some(
        (e) => e.id === eventId,
      ),
  );
  eventId = null;
  await expect("/company", "DELETE", undefined, owner, 200);
  companyCreated = false;
  for (const u of users) await expect("/me", "DELETE", undefined, u, 200);
  console.log(
    "OK: CRUD de contas, empresas, eventos e inscrições; autorização; disputa da última vaga; publicação e exclusão no Cassandra.",
  );
}
main().catch(async (e) => {
  console.error("FALHOU:", e.message);
  console.error("Tentando remover somente os dados criados por este teste…");
  try {
    for (const u of users)
      if (eventId)
        await request("/registrations/" + eventId, "DELETE", undefined, u);
    if (eventId && users[0]) {
      await request("/events/" + eventId, "DELETE", undefined, users[0]);
      await waitFor(
        async () =>
          !(await request("/my-events", "GET", undefined, users[0])).body.some(
            (e) => e.id === eventId,
          ),
      );
    }
    if (companyCreated)
      await request("/company", "DELETE", undefined, users[0]);
    for (const u of users) await request("/me", "DELETE", undefined, u);
  } catch {
    console.error(
      "Limpeza incompleta. Revise os registros com sufixo " + suffix,
    );
  }
  process.exitCode = 1;
});
