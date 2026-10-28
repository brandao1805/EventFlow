"use strict";
const {
  randomBytes,
  scrypt: rawScrypt,
  timingSafeEqual,
  createHash,
} = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(rawScrypt);
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}
async function verifyPassword(password, stored) {
  const [salt, hex] = stored.split(":");
  const key = await scrypt(password, salt, 64);
  const expected = Buffer.from(hex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}
const digest = (token) => createHash("sha256").update(token).digest("hex");
function cookieToken(req) {
  const value = (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("session="));
  return value ? value.slice(8) : "";
}
module.exports = { hashPassword, verifyPassword, digest, cookieToken };
