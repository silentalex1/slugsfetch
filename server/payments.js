import Stripe from "stripe";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEDGER = String(process.env.SLUGFETCH_LEDGER || "").trim() || join(__dirname, "donations.jsonl");

export const MIN_AMOUNT = 100;
export const MAX_AMOUNT = 999999;
export const PRESET_AMOUNTS = [1000, 1500, 3000];
export const DONATION_TAX_CODE = "txcd_90000001";
export const PREMIUM_MIN_AMOUNT = 500;

export function qualifiesForPremium(amount) {
  return Number(amount) > PREMIUM_MIN_AMOUNT;
}
export const CURRENCIES = new Set(["usd", "eur", "gbp", "cad", "aud"]);

const PLACEHOLDER = /^(sk_(test|live)_)?(your|xxx|placeholder|replace|changeme)/i;

function readKey() {
  const raw = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!raw || PLACEHOLDER.test(raw)) return null;
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(raw)) return null;
  return raw;
}

let client = null;
let clientKey = null;

function hostOverride() {
  const host = String(process.env.STRIPE_API_HOST || "").trim();
  if (!host) return null;
  return {
    host,
    port: Number(process.env.STRIPE_API_PORT || 12111),
    protocol: String(process.env.STRIPE_API_PROTOCOL || "http"),
  };
}

export function stripeClient() {
  const key = readKey();
  if (!key) return null;
  const override = hostOverride();
  const signature = `${key}|${override ? `${override.protocol}://${override.host}:${override.port}` : ""}`;
  if (!client || clientKey !== signature) {
    client = new Stripe(key, {
      apiVersion: "2025-08-27.basil",
      maxNetworkRetries: 2,
      timeout: 20000,
      ...(override || {}),
    });
    clientKey = signature;
  }
  return client;
}

export function paymentsStatus() {
  const key = readKey();
  return {
    configured: !!key,
    mode: key ? (key.includes("_live_") ? "live" : "test") : null,
    currency: defaultCurrency(),
    presets: PRESET_AMOUNTS,
    webhook: !!String(process.env.STRIPE_WEBHOOK_SECRET || "").trim(),
  };
}

export function defaultCurrency() {
  const c = String(process.env.SLUGFETCH_CURRENCY || "usd").toLowerCase();
  return CURRENCIES.has(c) ? c : "usd";
}

export function publicUrl() {
  const raw = String(process.env.SLUGFETCH_PUBLIC_URL || "http://127.0.0.1:5173").trim();
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "http://127.0.0.1:5173";
    return u.origin;
  } catch {
    return "http://127.0.0.1:5173";
  }
}

export function normalizeAmount(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return { error: "pick an amount first" };
  if (n < MIN_AMOUNT) return { error: `donations start at ${(MIN_AMOUNT / 100).toFixed(2)}` };
  if (n > MAX_AMOUNT) return { error: "that amount is above the limit for this form" };
  return { amount: n };
}

const rate = new Map();

export function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const hits = (rate.get(ip) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  rate.set(ip, hits);
  if (rate.size > 500) {
    for (const [k, v] of rate) {
      if (!v.some((t) => now - t < windowMs)) rate.delete(k);
    }
  }
  return hits.length > 12;
}

async function createSession(stripe, params) {
  try {
    return await stripe.checkout.sessions.create(params);
  } catch (e) {
    const unknownParam = /unknown parameter|unsupported parameter|invalid.*parameter/i.test(e?.message || "");
    if (params.managed_payments && unknownParam && /managed_payments/i.test(e?.message || "")) {
      const { managed_payments, ...rest } = params;
      return await stripe.checkout.sessions.create(rest);
    }
    throw e;
  }
}

export async function createDonationSession({ amount, currency, recurring, ip, account }) {
  const stripe = stripeClient();
  if (!stripe) {
    const err = new Error("payments are not configured on this server yet");
    err.status = 503;
    throw err;
  }

  const checked = normalizeAmount(amount);
  if (checked.error) {
    const err = new Error(checked.error);
    err.status = 400;
    throw err;
  }

  const cur = CURRENCIES.has(String(currency || "").toLowerCase())
    ? String(currency).toLowerCase()
    : defaultCurrency();

  const base = publicUrl();
  const isSub = !!recurring;

  const session = await createSession(stripe, {
    mode: isSub ? "subscription" : "payment",
    managed_payments: { enabled: false },
    billing_address_collection: "auto",
    ...(isSub ? {} : { submit_type: "donate" }),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: cur,
          unit_amount: checked.amount,
          ...(isSub ? { recurring: { interval: "month" } } : {}),
          product_data: {
            name: isSub ? "slugfetch monthly support" : "slugfetch donation",
            description: isSub
              ? "recurring support for slugfetch development and hosting"
              : "one-time support for slugfetch development and hosting",
            tax_code: DONATION_TAX_CODE,
          },
        },
      },
    ],
    success_url: `${base}/donate?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/donate?status=cancelled`,
    metadata: {
      source: "slugfetch",
      kind: isSub ? "monthly" : "one-time",
      ip: String(ip || "").slice(0, 45),
      account: account ? String(account).slice(0, 48) : "",
      premium: qualifiesForPremium(checked.amount) ? "yes" : "no",
    },
  });

  return {
    id: session.id,
    url: session.url,
    amount: checked.amount,
    currency: cur,
    recurring: isSub,
    premium: qualifiesForPremium(checked.amount),
  };
}

export function isSessionId(id) {
  return typeof id === "string" && /^cs_[A-Za-z0-9_]{10,200}$/.test(id);
}

export async function readSession(id) {
  const stripe = stripeClient();
  if (!stripe) {
    const err = new Error("payments are not configured on this server yet");
    err.status = 503;
    throw err;
  }
  if (!isSessionId(id)) {
    const err = new Error("invalid session id");
    err.status = 400;
    throw err;
  }

  const session = await stripe.checkout.sessions.retrieve(id);
  const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";

  return {
    id: session.id,
    paid: paid && session.status === "complete",
    status: session.status,
    paymentStatus: session.payment_status,
    amount: session.amount_total,
    currency: session.currency,
    recurring: session.mode === "subscription",
    email: session.customer_details?.email || null,
    account: session.metadata?.account || null,
    premium: qualifiesForPremium(session.amount_total),
  };
}

export function recordDonation(entry) {
  try {
    appendFileSync(LEDGER, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

export function readLedger(limit = 50) {
  try {
    if (!existsSync(LEDGER)) return [];
    return readFileSync(LEDGER, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch {
    return [];
  }
}

export function handleWebhook(rawBody, signature) {
  const stripe = stripeClient();
  const secret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!stripe || !secret || PLACEHOLDER.test(secret)) {
    const err = new Error("webhooks are not configured");
    err.status = 503;
    throw err;
  }

  const event = stripe.webhooks.constructEvent(rawBody, signature, secret);

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const s = event.data.object;
    const entry = {
      event: event.type,
      sessionId: s.id,
      amount: s.amount_total,
      currency: s.currency,
      kind: s.metadata?.kind || (s.mode === "subscription" ? "monthly" : "one-time"),
      account: s.metadata?.account || null,
      email: s.customer_details?.email || null,
      paymentStatus: s.payment_status,
    };
    recordDonation(entry);
    return { received: true, type: event.type, donation: entry };
  }

  return { received: true, type: event.type };
}
