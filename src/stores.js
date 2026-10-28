"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const mysql = require("mysql2/promise");
const { MongoClient } = require("mongodb");
const cassandra = require("cassandra-driver");
async function connect() {
  const sql = mysql.createPool({
    host: process.env.MYSQL_HOST || "mysql",
    user: process.env.MYSQL_USER || "eventflow",
    password: process.env.MYSQL_PASSWORD || "eventflow_local",
    database: "eventflow",
    connectionLimit: 10,
  });
  const mongoClient = new MongoClient(
    process.env.MONGO_URL || "mongodb://mongo:27017",
    { serverSelectionTimeoutMS: 5000 },
  );
  const cql = new cassandra.Client({
    contactPoints: [process.env.CASSANDRA_HOST || "cassandra"],
    localDataCenter: "datacenter1",
    queryOptions: { consistency: cassandra.types.consistencies.localQuorum },
  });
  await sql.query("SELECT 1");
  await mongoClient.connect();
  await cql.connect();
  for (const file of ["mysql.sql", "cassandra.cql"]) {
    const content = await fs.readFile(
      path.join(__dirname, "../db", file),
      "utf8",
    );
    for (const stmt of content
      .replace(/^--.*$/gm, "")
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean))
      await (file.endsWith(".sql") ? sql.query(stmt) : cql.execute(stmt));
  }
  const companies = mongoClient.db("eventflow").collection("companies");
  await companies.createIndex({ cnpj: 1 }, { unique: true });
  await companies.createIndex({ ownerId: 1 }, { unique: true });
  return {
    sql,
    companies,
    cql,
    close: async () => {
      await Promise.allSettled([
        sql.end(),
        mongoClient.close(),
        cql.shutdown(),
      ]);
    },
  };
}
async function transaction(sql, fn) {
  const conn = await sql.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
async function eventById(cql, id) {
  const r = await cql.execute(
    "SELECT payload FROM eventflow.events_by_id WHERE id=?",
    [id],
    { prepare: true },
  );
  return r.rows[0] ? JSON.parse(r.rows[0].payload) : null;
}
// Uma linha pendente por evento. Alterações seguintes aguardam a publicação anterior.
function makePublisher(stores) {
  let busy = false;
  return async function publish() {
    if (busy) return;
    busy = true;
    try {
      for (let n = 0; n < 30; n++) {
        const found = await transaction(stores.sql, async (conn) => {
          const [rows] = await conn.query(
            "SELECT * FROM outbox ORDER BY id LIMIT 1 FOR UPDATE",
          );
          if (!rows.length) return false;
          const row = rows[0];
          const job =
            typeof row.payload === "string"
              ? JSON.parse(row.payload)
              : row.payload;
          const ops = [];
          if (
            job.previous &&
            (job.remove ||
              job.previous.month !== job.event.month ||
              job.previous.startsAt !== job.event.startsAt)
          )
            ops.push({
              query:
                "DELETE FROM eventflow.events_by_month WHERE month=? AND starts_at=? AND id=?",
              params: [job.previous.month, job.previous.startsAt, row.event_id],
            });
          if (job.remove)
            ops.push({
              query: "DELETE FROM eventflow.events_by_id WHERE id=?",
              params: [row.event_id],
            });
          else {
            const data = JSON.stringify(job.event);
            ops.push({
              query:
                "INSERT INTO eventflow.events_by_id (id,payload) VALUES (?,?)",
              params: [row.event_id, data],
            });
            ops.push({
              query:
                "INSERT INTO eventflow.events_by_month (month,starts_at,id,payload) VALUES (?,?,?,?)",
              params: [job.event.month, job.event.startsAt, row.event_id, data],
            });
          }
          await stores.cql.batch(ops, { prepare: true, logged: true });
          await conn.execute(
            "UPDATE event_registry SET synced=TRUE WHERE id=?",
            [row.event_id],
          );
          await conn.execute("DELETE FROM outbox WHERE id=?", [row.id]);
          if (job.remove)
            await conn.execute("DELETE FROM event_registry WHERE id=?", [
              row.event_id,
            ]);
          return true;
        });
        if (!found) break;
      }
    } finally {
      busy = false;
    }
  };
}
module.exports = { connect, transaction, eventById, makePublisher };
