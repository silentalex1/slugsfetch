import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.STRIPE_SECRET_KEY = "sk_test_abc123fakekeyforlocaltests";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_localtestsecret";
process.env.SLUGFETCH_PUBLIC_URL = "https://slugfetch.example";
process.env.STRIPE_API_HOST = "127.0.0.1";
process.env.STRIPE_API_PORT = "12777";
process.env.STRIPE_API_PROTOCOL = "http";
process.env.SLUGFETCH_LEDGER = join(tmpdir(), "slugfetch-test-ledger.jsonl");

const {
  createDonationSession,
  readSession,
  handleWebhook,
  paymentsStatus,
  normalizeAmount,
  isSessionId,
  publicUrl,
} = await import("./payments.js");

const received = [];
let server;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ method: req.method, url: req.url, body, auth: req.headers.authorization });
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url.startsWith("/v1/checkout/sessions/")) {
        res.end(
          JSON.stringify({
            id: "cs_test_readback",
            object: "checkout.session",
            status: "complete",
            payment_status: "paid",
            amount_total: 1500,
            currency: "usd",
            mode: "payment",
            customer_details: { email: "donor@example.com" },
          })
        );
        return;
      }
      res.end(
        JSON.stringify({
          id: "cs_test_created",
          object: "checkout.session",
          url: "https://checkout.stripe.com/c/pay/cs_test_created",
        })
      );
    });
  });
  await new Promise((r) => server.listen(12777, "127.0.0.1", r));
});

after(() => server?.close());

test("rejects amounts outside the allowed range", () => {
  assert.equal(normalizeAmount(50).error !== undefined, true);
  assert.equal(normalizeAmount(0).error !== undefined, true);
  assert.equal(normalizeAmount(-500).error !== undefined, true);
  assert.equal(normalizeAmount(10_000_000).error !== undefined, true);
  assert.equal(normalizeAmount("nonsense").error !== undefined, true);
  assert.equal(normalizeAmount(1500).amount, 1500);
  assert.equal(normalizeAmount("2500").amount, 2500);
});

test("reports configured test mode", () => {
  const status = paymentsStatus();
  assert.equal(status.configured, true);
  assert.equal(status.mode, "test");
  assert.equal(status.webhook, true);
});

test("public url falls back when misconfigured", () => {
  assert.equal(publicUrl(), "https://slugfetch.example");
});

test("one-time donation sends a card checkout session", async () => {
  received.length = 0;
  const session = await createDonationSession({ amount: 1500, currency: "usd", ip: "127.0.0.1" });

  assert.equal(session.url, "https://checkout.stripe.com/c/pay/cs_test_created");
  assert.equal(received.length, 1);

  const sent = new URLSearchParams(received[0].body);
  assert.equal(received[0].method, "POST");
  assert.equal(received[0].url, "/v1/checkout/sessions");
  assert.match(received[0].auth, /^Bearer sk_test_/);
  assert.equal(sent.get("mode"), "payment");
  assert.equal(sent.get("submit_type"), "donate");
  assert.equal(
    sent.get("payment_method_types[0]"),
    null,
    "payment_method_types must stay unset: accounts with Managed Payments reject it"
  );
  assert.equal(sent.get("line_items[0][price_data][unit_amount]"), "1500");
  assert.equal(sent.get("line_items[0][price_data][currency]"), "usd");
  assert.equal(sent.get("line_items[0][quantity]"), "1");
  assert.equal(sent.get("line_items[0][price_data][product_data][tax_code]"), "txcd_90000001");
  assert.equal(sent.get("success_url"), "https://slugfetch.example/donate?status=success&session_id={CHECKOUT_SESSION_ID}");
  assert.equal(sent.get("cancel_url"), "https://slugfetch.example/donate?status=cancelled");
  assert.equal(sent.get("line_items[0][price_data][recurring][interval]"), null);
});

test("monthly donation switches to a subscription", async () => {
  received.length = 0;
  await createDonationSession({ amount: 500, recurring: true });

  const sent = new URLSearchParams(received[0].body);
  assert.equal(sent.get("mode"), "subscription");
  assert.equal(sent.get("line_items[0][price_data][recurring][interval]"), "month");
  assert.equal(sent.get("submit_type"), null);
});

test("unknown currency falls back instead of reaching stripe", async () => {
  received.length = 0;
  const session = await createDonationSession({ amount: 1000, currency: "doge" });
  assert.equal(session.currency, "usd");
});

test("client amounts are validated before any network call", async () => {
  received.length = 0;
  await assert.rejects(() => createDonationSession({ amount: 1 }), /donations start at/);
  await assert.rejects(() => createDonationSession({ amount: 50_000_000 }), /above the limit/);
  assert.equal(received.length, 0);
});

test("session ids are validated", async () => {
  assert.equal(isSessionId("cs_test_a1b2c3d4e5f6g7h8"), true);
  assert.equal(isSessionId("../../etc/passwd"), false);
  assert.equal(isSessionId("pi_test_123"), false);
  await assert.rejects(() => readSession("not-a-session"), /invalid session id/);
});

test("reads back a paid session", async () => {
  const receipt = await readSession("cs_test_a1b2c3d4e5f6g7h8");
  assert.equal(receipt.paid, true);
  assert.equal(receipt.amount, 1500);
  assert.equal(receipt.email, "donor@example.com");
});

test("webhook rejects a forged signature", () => {
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: {} } });
  assert.throws(() => handleWebhook(Buffer.from(payload), "t=1,v1=deadbeef"), /signature/i);
  assert.throws(() => handleWebhook(Buffer.from(payload), ""), /signature|header/i);
});

test("webhook accepts a correctly signed event", () => {
  const payload = JSON.stringify({
    id: "evt_2",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_hook",
        amount_total: 3000,
        currency: "usd",
        mode: "payment",
        payment_status: "paid",
        metadata: { kind: "one-time" },
        customer_details: { email: "hook@example.com" },
      },
    },
  });
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", "whsec_localtestsecret").update(`${ts}.${payload}`).digest("hex");
  const result = handleWebhook(Buffer.from(payload), `t=${ts},v1=${sig}`);
  assert.equal(result.received, true);
  assert.equal(result.type, "checkout.session.completed");
});
