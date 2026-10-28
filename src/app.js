"use strict";
const express = require("express");
const path = require("node:path");
const { randomUUID, randomBytes } = require("node:crypto");
const { ObjectId } = require("mongodb");
const V = require("./validation");
const S = require("./security");
const { transaction, eventById } = require("./stores");
function createApp(stores) {
  const { sql, companies, cql } = stores;
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    if (req.path.startsWith("/api")) res.set("Cache-Control", "no-store");
    next();
  });
  // Cabeçalho customizado impede submissões cross-site; não habilitamos CORS.
  app.use("/api", (req, res, next) => {
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.get("X-Requested-With") !== "EventFlow"
    )
      return res
        .status(403)
        .json({ message: "Origem da requisição não permitida." });
    next();
  });
  const asyncRoute = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res)).catch(next);
  const auth = async (req) => {
    const token = S.cookieToken(req);
    V.fail(!token, 401, "Entre na sua conta.");
    const [rows] = await sql.execute(
      "SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>NOW()",
      [S.digest(token)],
    );
    V.fail(!rows.length, 401, "Sessão expirada. Entre novamente.");
    return rows[0];
  };
  const route = (method, url, fn, secure = true) =>
    app[method](
      url,
      asyncRoute(async (req, res) =>
        fn(req, res, secure ? await auth(req) : null),
      ),
    );
  const ownerLock = async (conn, id) => {
    const [rows] = await conn.execute(
      "SELECT id FROM users WHERE id=? FOR UPDATE",
      [id],
    );
    V.fail(!rows.length, 401, "Conta não encontrada.");
  };
  const myCompany = async (id) => companies.findOne({ ownerId: id });
  const registry = async (conn, id) => {
    const [rows] = await conn.execute(
      "SELECT * FROM event_registry WHERE id=? FOR UPDATE",
      [id],
    );
    V.fail(!rows.length || !rows[0].active, 404, "Evento não encontrado.");
    return rows[0];
  };
  const serializeCompany = (c) => (c ? { ...c, _id: String(c._id) } : null);
  const attempts = new Map();
  function rateLimit(req) {
    const key = req.ip;
    const now = Date.now();
    let entry = attempts.get(key);
    if (!entry || entry.until < now) {
      entry = { count: 0, until: now + 60000 };
      attempts.set(key, entry);
    }
    V.fail(++entry.count > 15, 429, "Muitas tentativas. Aguarde um minuto.");
    if (attempts.size > 10000)
      for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  }
  route(
    "post",
    "/api/users",
    async (req, res) => {
      rateLimit(req);
      const b = V.user(req.body);
      const id = randomUUID();
      await sql.execute(
        "INSERT INTO users(id,name,email,password_hash) VALUES (?,?,?,?)",
        [id, b.name, b.email, await S.hashPassword(b.password)],
      );
      res.status(201).json({ id, name: b.name, email: b.email });
    },
    false,
  );
  route(
    "post",
    "/api/login",
    async (req, res) => {
      rateLimit(req);
      const email = V.text(req.body.email, "E-mail", 180).toLowerCase();
      const password = V.text(req.body.password, "Senha", 128);
      const [rows] = await sql.execute("SELECT * FROM users WHERE email=?", [
        email,
      ]);
      V.fail(
        !rows.length ||
          !(await S.verifyPassword(password, rows[0].password_hash)),
        401,
        "E-mail ou senha incorretos.",
      );
      const token = randomBytes(32).toString("hex");
      await sql.execute("DELETE FROM sessions WHERE expires_at<NOW()");
      await sql.execute(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 12 HOUR))",
        [S.digest(token), rows[0].id],
      );
      res.cookie("session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.COOKIE_SECURE === "true",
        maxAge: 12 * 3600000,
        path: "/",
      });
      res.json({ id: rows[0].id, name: rows[0].name, email: rows[0].email });
    },
    false,
  );
  route("post", "/api/logout", async (req, res) => {
    await sql.execute("DELETE FROM sessions WHERE token_hash=?", [
      S.digest(S.cookieToken(req)),
    ]);
    res.clearCookie("session", { path: "/" });
    res.json({ message: "Você saiu da conta." });
  });
  route("get", "/api/me", async (req, res, u) => res.json(u));
  route("put", "/api/me", async (req, res, u) => {
    const b = V.user(req.body, false);
    await transaction(sql, async (conn) => {
      await ownerLock(conn, u.id);
      if (b.password) {
        await conn.execute(
          "UPDATE users SET name=?,email=?,password_hash=? WHERE id=?",
          [b.name, b.email, await S.hashPassword(b.password), u.id],
        );
        await conn.execute(
          "DELETE FROM sessions WHERE user_id=? AND token_hash<>?",
          [u.id, S.digest(S.cookieToken(req))],
        );
      } else
        await conn.execute("UPDATE users SET name=?,email=? WHERE id=?", [
          b.name,
          b.email,
          u.id,
        ]);
    });
    res.json({ id: u.id, name: b.name, email: b.email });
  });
  route("delete", "/api/me", async (req, res, u) => {
    await transaction(sql, async (conn) => {
      await ownerLock(conn, u.id);
      V.fail(
        await myCompany(u.id),
        409,
        "Exclua sua empresa e seus eventos antes de excluir a conta.",
      );
      const [regs] = await conn.execute(
        "SELECT event_id FROM registrations WHERE user_id=? LIMIT 1",
        [u.id],
      );
      V.fail(
        regs.length,
        409,
        "Cancele suas inscrições antes de excluir a conta.",
      );
      await conn.execute("DELETE FROM users WHERE id=?", [u.id]);
    });
    res.clearCookie("session", { path: "/" });
    res.json({ message: "Conta excluída." });
  });
  route("get", "/api/company", async (req, res, u) =>
    res.json(serializeCompany(await myCompany(u.id))),
  );
  route("post", "/api/company", async (req, res, u) => {
    const b = V.company(req.body);
    const c = await transaction(sql, async (conn) => {
      await ownerLock(conn, u.id);
      V.fail(await myCompany(u.id), 409, "Você já possui uma empresa.");
      const doc = { ...b, ownerId: u.id, createdAt: new Date() };
      const r = await companies.insertOne(doc);
      return { ...doc, _id: r.insertedId };
    });
    res.status(201).json(serializeCompany(c));
  });
  route("put", "/api/company", async (req, res, u) => {
    const b = V.company(req.body);
    await transaction(sql, async (conn) => {
      await ownerLock(conn, u.id);
      const r = await companies.updateOne(
        { ownerId: u.id },
        { $set: { ...b, updatedAt: new Date() } },
      );
      V.fail(!r.matchedCount, 404, "Empresa não encontrada.");
    });
    res.json(serializeCompany(await myCompany(u.id)));
  });
  route("delete", "/api/company", async (req, res, u) => {
    await transaction(sql, async (conn) => {
      await ownerLock(conn, u.id);
      const c = await myCompany(u.id);
      V.fail(!c, 404, "Empresa não encontrada.");
      const [rows] = await conn.execute(
        "SELECT id FROM event_registry WHERE company_id=? LIMIT 1",
        [String(c._id)],
      );
      V.fail(
        rows.length,
        409,
        "Exclua os eventos e aguarde a sincronização antes de excluir a empresa.",
      );
      await companies.deleteOne({ _id: c._id, ownerId: u.id });
    });
    res.json({ message: "Empresa excluída." });
  });
  route(
    "get",
    "/api/events",
    async (req, res) => {
      const month = V.month(req.query.month);
      const token = req.query.cursor;
      V.fail(
        token &&
          (typeof token !== "string" ||
            token.length > 2000 ||
            !/^[A-Za-z0-9+/=]+$/.test(token)),
        400,
        "Cursor inválido.",
      );
      let result;
      try {
        result = await cql.execute(
          "SELECT payload FROM eventflow.events_by_month WHERE month=?",
          [month],
          {
            prepare: true,
            fetchSize: 50,
            pageState: token ? Buffer.from(token, "base64") : undefined,
          },
        );
      } catch (e) {
        if (token && e.code === 8704)
          throw new V.ApiError(400, "Cursor inválido.");
        throw e;
      }
      const items = [];
      for (const row of result.rows) {
        const ev = JSON.parse(row.payload);
        const [r] = await sql.execute(
          "SELECT reserved,active,synced FROM event_registry WHERE id=?",
          [ev.id],
        );
        if (r[0]?.active && r[0].synced)
          items.push({ ...ev, reserved: r[0].reserved });
      }
      res.json({
        items,
        cursor: result.pageState
          ? Buffer.from(result.pageState, "hex").toString("base64")
          : null,
      });
    },
    false,
  );
  route("get", "/api/my-events", async (req, res, u) => {
    const [rows] = await sql.execute(
      "SELECT * FROM event_registry WHERE owner_id=? ORDER BY id",
      [u.id],
    );
    const items = [];
    for (const r of rows) {
      let ev = await eventById(cql, r.id);
      if (!r.synced) {
        const [jobs] = await sql.execute(
          "SELECT payload FROM outbox WHERE event_id=?",
          [r.id],
        );
        if (jobs[0]) {
          const j =
            typeof jobs[0].payload === "string"
              ? JSON.parse(jobs[0].payload)
              : jobs[0].payload;
          ev = j.event || j.previous;
        }
      }
      if (ev)
        items.push({
          ...ev,
          reserved: r.reserved,
          pending: !r.synced,
          deleting: !r.active,
        });
    }
    res.json(items);
  });
  route("post", "/api/events", async (req, res, u) => {
    const b = V.event(req.body);
    const id = randomUUID();
    await transaction(sql, async (conn) => {
      await ownerLock(conn, u.id);
      const company = await myCompany(u.id);
      V.fail(!company, 409, "Cadastre sua empresa primeiro.");
      const ev = {
        ...b,
        id,
        companyId: String(company._id),
        companyName: company.name,
        ownerId: u.id,
      };
      await conn.execute(
        "INSERT INTO event_registry(id,company_id,owner_id,month,capacity) VALUES (?,?,?,?,?)",
        [id, ev.companyId, u.id, b.month, b.capacity],
      );
      await conn.execute("INSERT INTO outbox(event_id,payload) VALUES (?,?)", [
        id,
        JSON.stringify({ event: ev }),
      ]);
    });
    res
      .status(202)
      .json({ id, message: "Evento salvo. Publicação em processamento." });
  });
  route("put", "/api/events/:id", async (req, res, u) => {
    const b = V.event(req.body);
    await transaction(sql, async (conn) => {
      await ownerLock(conn, u.id);
      const r = await registry(conn, req.params.id);
      V.fail(
        r.owner_id !== u.id,
        403,
        "Este evento pertence a outro organizador.",
      );
      V.fail(!r.synced, 409, "Aguarde a publicação anterior.");
      V.fail(
        b.capacity < r.reserved,
        409,
        "Capacidade inferior ao número de inscritos.",
      );
      const previous = await eventById(cql, r.id);
      V.fail(!previous, 503, "Evento ainda indisponível no catálogo.");
      const c = await myCompany(u.id);
      const ev = { ...previous, ...b, companyName: c.name };
      await conn.execute(
        "UPDATE event_registry SET capacity=?,month=?,synced=FALSE WHERE id=?",
        [b.capacity, b.month, r.id],
      );
      await conn.execute("INSERT INTO outbox(event_id,payload) VALUES (?,?)", [
        r.id,
        JSON.stringify({ event: ev, previous }),
      ]);
    });
    res
      .status(202)
      .json({ message: "Alteração salva. Publicação em processamento." });
  });
  route("delete", "/api/events/:id", async (req, res, u) => {
    await transaction(sql, async (conn) => {
      await ownerLock(conn, u.id);
      const r = await registry(conn, req.params.id);
      V.fail(
        r.owner_id !== u.id,
        403,
        "Este evento pertence a outro organizador.",
      );
      V.fail(!r.synced, 409, "Aguarde a publicação anterior.");
      V.fail(
        r.reserved > 0,
        409,
        "O evento possui inscritos. Eles devem cancelar as inscrições antes da exclusão.",
      );
      const previous = await eventById(cql, r.id);
      V.fail(!previous, 503, "Catálogo indisponível.");
      await conn.execute(
        "UPDATE event_registry SET active=FALSE,synced=FALSE WHERE id=?",
        [r.id],
      );
      await conn.execute("INSERT INTO outbox(event_id,payload) VALUES (?,?)", [
        r.id,
        JSON.stringify({ remove: true, previous }),
      ]);
    });
    res.status(202).json({ message: "Exclusão em processamento." });
  });
  route("get", "/api/registrations", async (req, res, u) => {
    const [rows] = await sql.execute(
      "SELECT * FROM registrations WHERE user_id=? ORDER BY created_at DESC",
      [u.id],
    );
    const items = [];
    for (const r of rows) {
      const ev = await eventById(cql, r.event_id);
      items.push({ ...r, event: ev });
    }
    res.json(items);
  });
  route("post", "/api/events/:id/registrations", async (req, res, u) => {
    await transaction(sql, async (conn) => {
      await ownerLock(conn, u.id);
      const r = await registry(conn, req.params.id);
      V.fail(!r.synced, 409, "Evento em atualização. Tente novamente.");
      const ev = await eventById(cql, r.id);
      V.fail(
        !ev || Date.parse(ev.startsAt) <= Date.now(),
        409,
        "Inscrições encerradas.",
      );
      const [exists] = await conn.execute(
        "SELECT user_id FROM registrations WHERE user_id=? AND event_id=?",
        [u.id, r.id],
      );
      V.fail(exists.length, 409, "Você já está inscrito.");
      V.fail(r.reserved >= r.capacity, 409, "Vagas esgotadas.");
      await conn.execute(
        "INSERT INTO registrations(user_id,event_id) VALUES (?,?)",
        [u.id, r.id],
      );
      await conn.execute(
        "UPDATE event_registry SET reserved=reserved+1 WHERE id=?",
        [r.id],
      );
    });
    res.status(201).json({ message: "Inscrição confirmada!" });
  });
  route("put", "/api/registrations/:id", async (req, res, u) => {
    const note = V.text(req.body.note || "", "Observação", 200, 0);
    const [r] = await sql.execute(
      "UPDATE registrations SET note=? WHERE user_id=? AND event_id=?",
      [note, u.id, req.params.id],
    );
    V.fail(!r.affectedRows, 404, "Inscrição não encontrada.");
    res.json({ message: "Observação atualizada." });
  });
  route("delete", "/api/registrations/:id", async (req, res, u) => {
    await transaction(sql, async (conn) => {
      await ownerLock(conn, u.id);
      await registry(conn, req.params.id);
      const [r] = await conn.execute(
        "DELETE FROM registrations WHERE user_id=? AND event_id=?",
        [u.id, req.params.id],
      );
      V.fail(!r.affectedRows, 404, "Inscrição não encontrada.");
      await conn.execute(
        "UPDATE event_registry SET reserved=reserved-1 WHERE id=?",
        [req.params.id],
      );
    });
    res.json({ message: "Inscrição cancelada." });
  });
  route(
    "get",
    "/api/health",
    async (req, res) => {
      const checks = await Promise.allSettled([
        sql.query("SELECT 1"),
        companies.findOne({}),
        cql.execute("SELECT release_version FROM system.local"),
      ]);
      const names = ["mysql", "mongodb", "cassandra"];
      const databases = Object.fromEntries(
        checks.map((r, i) => [
          names[i],
          r.status === "fulfilled" ? "online" : "offline",
        ]),
      );
      res
        .status(checks.every((r) => r.status === "fulfilled") ? 200 : 503)
        .json({ databases });
    },
    false,
  );
  app.use("/api", (req, res) =>
    res.status(404).json({ message: "Rota não encontrada." }),
  );
  app.use(express.static(path.join(__dirname, "../public")));
  app.use((err, req, res, next) => {
    if (err.code === "ER_DUP_ENTRY" || err.code === 11000)
      return res
        .status(409)
        .json({ message: "E-mail, CNPJ ou registro já cadastrado." });
    if (err.type === "entity.parse.failed")
      return res.status(400).json({ message: "JSON inválido." });
    if (err.status)
      return res.status(err.status).json({ message: err.message });
    console.error("Falha na requisição:", err.code || err.name);
    res
      .status(503)
      .json({
        message: "Serviço temporariamente indisponível. Tente novamente.",
      });
  });
  return app;
}
module.exports = { createApp };
