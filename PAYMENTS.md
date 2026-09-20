# donations

The donate page runs on Stripe Checkout. Card details are entered on Stripe's own
hosted page, so no card number, CVC or expiry ever reaches slugfetch. That keeps
this app out of PCI-DSS scope.

## turning it on

1. Create a Stripe account, then open the dashboard in **test mode**.
2. Copy the secret key from Developers -> API keys. It starts with `sk_test_`.
3. Copy `.env.example` to `.env` and paste the key in:

```bash
cp .env.example .env
```

```
SLUGFETCH_PUBLIC_URL=http://127.0.0.1:5173
STRIPE_SECRET_KEY=sk_test_your_key_here
```

4. Restart the engine. The donate page picks it up and shows a test-mode notice.

`SLUGFETCH_PUBLIC_URL` is the origin Stripe sends people back to after paying.
Set it to your real domain before going live, or the return links point at
localhost.

## testing a payment

In test mode use card `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.
Other useful cards:

| card | result |
| --- | --- |
| 4242 4242 4242 4242 | succeeds |
| 4000 0000 0000 9995 | declined, insufficient funds |
| 4000 0025 0000 3155 | requires 3D Secure authentication |

No real money moves while the key starts with `sk_test_`.

## webhooks

Webhooks are optional for the payment itself, but without them a donation that
completes after the user closes the tab is never recorded. To enable:

```bash
stripe listen --forward-to 127.0.0.1:8787/api/donate/webhook
```

Put the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET` and restart. Completed
donations append to `server/donations.jsonl`, which is gitignored.

Signatures are verified on every webhook request. Unsigned or forged requests are
rejected with a 400.

## account settings that affect this

Two things on the Stripe account side changed what the code has to send. Both are
handled, but worth knowing if you switch accounts.

**Managed Payments.** Enabled by default on newer accounts. It rejects
`payment_method_types` and demands a product tax code, but it does not support
donations at all, so every donation tax code is ineligible. Sessions are created
with `managed_payments: { enabled: false }`, and the code silently retries
without that parameter on older accounts that do not recognise it.

**Phone number collection.** Checkout currently asks donors for a phone number
and refuses to submit without one. That is an account setting, not something this
code sends. If you want to drop it, turn off phone number collection under
Settings -> Checkout and Payment Links in the dashboard.

## going live

1. Swap the key for the `sk_live_...` one from the dashboard's live mode.
2. Point `SLUGFETCH_PUBLIC_URL` at your real HTTPS domain.
3. Register the production webhook endpoint in the Stripe dashboard and use that
   signing secret.
4. Serve the app over HTTPS. Stripe will refuse live redirects back to plain http.

The donate page shows a blue test-mode banner whenever the key is a test key, so
a live deployment that accidentally still has test keys is obvious on sight.

## accounts and premium

Donating runs through `/checkout`, where the donor picks a username and password.
The account is created first, then Stripe is handed the username in session
metadata. When the payment clears, the server flips `premium` on that account.

Premium requires a donation **above $5**. The presets are $10, $15 and $30, so all
of them qualify; a custom amount of $5 or less still donates but does not unlock
premium. That threshold lives in `PREMIUM_MIN_AMOUNT` in `server/payments.js`.

Passwords are hashed with scrypt (N=16384, r=8, p=1) using a per-account random
salt, and compared in constant time. Accounts live in `server/accounts.json`,
which is gitignored. Nothing in that file can be reversed into a password.

Premium is only ever granted from a Stripe-confirmed payment, in two places: when
the donor returns to the success URL, and again from the webhook. A client cannot
ask for premium directly.

## what is validated server side

- The amount is re-checked on the server. A tampered client request cannot set a
  price the server did not approve. Range is 1.00 to 9999.99.
- Currency is checked against an allowlist.
- Session ids are pattern matched before being sent to Stripe.
- Checkout creation is rate limited to 12 attempts per IP per 5 minutes.

Run `npm test` to exercise all of the above against a local mock of the Stripe API.
