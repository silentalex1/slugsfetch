import Stripe from "stripe";

process.loadEnvFile(".env");

const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(key)) {
  console.error("STRIPE_SECRET_KEY is missing or malformed in .env");
  process.exit(1);
}

const live = key.includes("_live_");
const stripe = new Stripe(key);
const OFF = { display_preference: { preference: "off" } };
const REMOVE = [
  "link",
  "klarna",
  "pay_by_bank",
  "cashapp",
  "amazon_pay",
  "affirm",
  "afterpay_clearpay",
  "blik",
  "eps",
  "bancontact",
  "kakao_pay",
  "mb_way",
  "naver_pay",
  "payco",
  "pix",
  "promptpay",
  "samsung_pay",
  "satispay",
];

console.log(`mode: ${live ? "LIVE" : "test"}`);

const account = await stripe.accounts.retrieve();
console.log(`account: ${account.id} (${account.country})`);
console.log(`charges_enabled: ${account.charges_enabled} | payouts_enabled: ${account.payouts_enabled}`);

const due = account.requirements?.currently_due || [];
if (due.length) console.log(`outstanding requirements: ${due.join(", ")}`);

const configs = await stripe.paymentMethodConfigurations.list({ limit: 10 });
for (const config of configs.data) {
  if (!config.active) continue;

  for (const method of REMOVE) {
    if (!config[method] || config[method].display_preference?.value !== "on") continue;
    try {
      await stripe.paymentMethodConfigurations.update(config.id, { [method]: OFF });
    } catch (e) {
      console.log(`  could not disable ${method}: ${e.message.slice(0, 80)}`);
    }
  }

  const fresh = await stripe.paymentMethodConfigurations.retrieve(config.id);
  const on = Object.entries(fresh)
    .filter(([, v]) => v && typeof v === "object" && v.display_preference?.value === "on")
    .map(([k]) => k);
  console.log(`${config.id} -> enabled: ${on.join(", ") || "(none)"}`);
}

if (live) {
  const base = String(process.env.SLUGFETCH_PUBLIC_URL || "").trim();
  if (!base.startsWith("https://")) {
    console.log("");
    console.log("WARNING: SLUGFETCH_PUBLIC_URL is not https. Live checkout will refuse to redirect back.");
  }
  if (!String(process.env.STRIPE_WEBHOOK_SECRET || "").trim()) {
    console.log("WARNING: STRIPE_WEBHOOK_SECRET is unset, late-completing donations will not be recorded.");
  }
}
