import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE = String(process.env.SLUGFETCH_ACCOUNTS || "").trim() || join(__dirname, "accounts.json");

export const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,23}$/;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = existsSync(STORE) ? JSON.parse(readFileSync(STORE, "utf8")) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function persist() {
  const tmp = `${STORE}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf8");
  renameSync(tmp, STORE);
}

function hash(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) return reject(err);
      resolve(key.toString("hex"));
    });
  });
}

function sameHash(a, b) {
  const left = Buffer.from(String(a), "hex");
  const right = Buffer.from(String(b), "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export function validateCredentials(username, password) {
  const name = String(username || "").trim();
  const pass = String(password || "");

  if (!USERNAME_RE.test(name)) {
    return { error: "usernames are 3 to 24 characters, letters, numbers, dot, dash or underscore" };
  }
  if (pass.length < MIN_PASSWORD) {
    return { error: `passwords need at least ${MIN_PASSWORD} characters` };
  }
  if (pass.length > MAX_PASSWORD) {
    return { error: "that password is too long" };
  }
  return { username: name, password: pass };
}

export function publicAccount(account) {
  if (!account) return null;
  return {
    username: account.username,
    premium: !!account.premium,
    premiumSince: account.premiumSince || null,
    createdAt: account.createdAt,
  };
}

export function findAccount(username) {
  const accounts = load();
  return accounts[String(username || "").toLowerCase()] || null;
}

export async function claimAccount(username, password) {
  const checked = validateCredentials(username, password);
  if (checked.error) return { error: checked.error, status: 400 };

  const accounts = load();
  const key = checked.username.toLowerCase();
  const existing = accounts[key];

  if (existing) {
    const attempt = await hash(checked.password, existing.salt);
    if (!sameHash(attempt, existing.hash)) {
      return { error: "that username is taken and the password does not match it", status: 401 };
    }
    existing.token = randomBytes(24).toString("hex");
    existing.lastSeen = Date.now();
    persist();
    return { account: existing, created: false };
  }

  const salt = randomBytes(16).toString("hex");
  const account = {
    username: checked.username,
    salt,
    hash: await hash(checked.password, salt),
    token: randomBytes(24).toString("hex"),
    premium: false,
    premiumSince: null,
    createdAt: Date.now(),
    lastSeen: Date.now(),
  };
  accounts[key] = account;
  persist();
  return { account, created: true };
}

export function authenticate(username, token) {
  const account = findAccount(username);
  if (!account || !token) return null;
  const a = Buffer.from(String(account.token || ""), "utf8");
  const b = Buffer.from(String(token), "utf8");
  if (a.length !== b.length || a.length === 0) return null;
  return timingSafeEqual(a, b) ? account : null;
}

export function grantPremium(username, detail) {
  const account = findAccount(username);
  if (!account) return null;
  if (!account.premium) {
    account.premium = true;
    account.premiumSince = Date.now();
  }
  account.lastPayment = {
    amount: detail?.amount ?? null,
    currency: detail?.currency ?? null,
    sessionId: detail?.sessionId ?? null,
    at: Date.now(),
  };
  persist();
  return account;
}

export function accountCount() {
  return Object.keys(load()).length;
}
