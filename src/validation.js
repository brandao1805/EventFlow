"use strict";
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (condition, status, message) => {
  if (condition) throw new ApiError(status, message);
};
function text(value, name, max = 100, min = 1) {
  fail(typeof value !== "string", 400, `${name}: informe um texto.`);
  const out = value.trim();
  fail(
    out.length < min || out.length > max,
    400,
    `${name}: use entre ${min} e ${max} caracteres.`,
  );
  return out;
}
function user(body, requirePassword = true) {
  const name = text(body.name, "Nome");
  const email = text(body.email, "E-mail", 180).toLowerCase();
  fail(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 400, "E-mail inválido.");
  let password;
  if (requirePassword || body.password)
    password = text(body.password, "Senha", 128, 8);
  return { name, email, password };
}
function company(b) {
  const cnpj = text(b.cnpj, "CNPJ", 18).replace(/\D/g, "");
  fail(!/^\d{14}$/.test(cnpj), 400, "CNPJ deve conter 14 dígitos.");
  const address = b.address || {};
  const tags = Array.isArray(b.tags) ? b.tags : [];
  fail(tags.length > 10, 400, "Máximo de 10 especialidades.");
  return {
    name: text(b.name, "Nome"),
    cnpj,
    description: text(b.description || "", "Descrição", 1000, 0),
    address: {
      city: text(address.city, "Cidade"),
      street: text(address.street || "", "Endereço", 200, 0),
    },
    tags: tags.map((t) => text(t, "Especialidade", 40)),
    contact: text(b.contact || "", "Contato", 180, 0),
  };
}
function event(b) {
  const startsAt = text(b.startsAt, "Data", 30);
  const date = new Date(startsAt);
  fail(!Number.isFinite(date.getTime()), 400, "Data inválida.");
  fail(date.getTime() <= Date.now(), 400, "O evento deve ocorrer no futuro.");
  fail(
    !Number.isSafeInteger(b.capacity) || b.capacity < 1 || b.capacity > 100000,
    400,
    "Capacidade deve ser um inteiro entre 1 e 100.000.",
  );
  fail(
    !Number.isSafeInteger(b.priceCents) ||
      b.priceCents < 0 ||
      b.priceCents > 100000000,
    400,
    "Preço inválido.",
  );
  return {
    title: text(b.title, "Título", 120),
    description: text(b.description || "", "Descrição", 2000, 0),
    startsAt: date.toISOString(),
    month: date.toISOString().slice(0, 7),
    capacity: b.capacity,
    priceCents: b.priceCents,
    location: text(b.location, "Local", 200),
    city: text(b.city, "Cidade"),
    category: text(b.category || "Outros", "Categoria", 50),
  };
}
function month(value) {
  fail(
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(value || ""),
    400,
    "Mês inválido (AAAA-MM).",
  );
  return value;
}
module.exports = { ApiError, fail, text, user, company, event, month };
