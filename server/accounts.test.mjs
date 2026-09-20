import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, existsSync, readFileSync } from "node:fs";

const STORE = join(tmpdir(), `slugfetch-accounts-test-${Date.now()}.json`);
process.env.SLUGFETCH_ACCOUNTS = STORE;

const { claimAccount, authenticate, grantPremium, publicAccount, findAccount, validateCredentials } = await import(
  "./accounts.js"
);
const { qualifiesForPremium, PREMIUM_MIN_AMOUNT, PRESET_AMOUNTS } = await import("./payments.js");

before(() => {
  if (existsSync(STORE)) rmSync(STORE);
});

after(() => {
  if (existsSync(STORE)) rmSync(STORE);
});

test("rejects weak or malformed credentials", () => {
  assert.match(validateCredentials("ab", "longenoughpassword").error, /3 to 24/);
  assert.match(validateCredentials("has space", "longenoughpassword").error, /3 to 24/);
  assert.match(validateCredentials("bad!char", "longenoughpassword").error, /3 to 24/);
  assert.match(validateCredentials("goodname", "short").error, /8 characters/);
  assert.equal(validateCredentials("goodname", "longenoughpassword").username, "goodname");
});

test("creates an account without storing the password", async () => {
  const result = await claimAccount("donor_one", "correcthorsebattery");
  assert.equal(result.created, true);
  assert.equal(result.account.username, "donor_one");
  assert.equal(result.account.premium, false);
  assert.ok(result.account.token.length >= 32);

  const raw = readFileSync(STORE, "utf8");
  assert.equal(raw.includes("correcthorsebattery"), false);
  assert.equal(publicAccount(result.account).hash, undefined);
});

test("same credentials sign in instead of duplicating", async () => {
  const again = await claimAccount("donor_one", "correcthorsebattery");
  assert.equal(again.created, false);
  assert.equal(again.account.username, "donor_one");
});

test("wrong password is refused", async () => {
  const bad = await claimAccount("donor_one", "notthepassword");
  assert.equal(bad.account, undefined);
  assert.equal(bad.status, 401);
});

test("tokens gate account reads", async () => {
  const { account } = await claimAccount("donor_two", "anotherlongpassword");
  assert.equal(authenticate("donor_two", account.token)?.username, "donor_two");
  assert.equal(authenticate("donor_two", "wrong-token"), null);
  assert.equal(authenticate("donor_two", ""), null);
  assert.equal(authenticate("ghost_user", account.token), null);
});

test("premium threshold sits above five dollars", () => {
  assert.equal(qualifiesForPremium(PREMIUM_MIN_AMOUNT), false);
  assert.equal(qualifiesForPremium(500), false);
  assert.equal(qualifiesForPremium(100), false);
  assert.equal(qualifiesForPremium(501), true);
  assert.equal(qualifiesForPremium(1000), true);
});

test("presets no longer offer five dollars", () => {
  assert.equal(PRESET_AMOUNTS.includes(500), false);
  assert.deepEqual(PRESET_AMOUNTS, [1000, 1500, 3000]);
  assert.equal(PRESET_AMOUNTS.every((a) => qualifiesForPremium(a)), true);
});

test("granting premium records the payment", () => {
  const before = findAccount("donor_two");
  assert.equal(before.premium, false);

  const after = grantPremium("donor_two", { amount: 1000, currency: "usd", sessionId: "cs_test_x" });
  assert.equal(after.premium, true);
  assert.ok(after.premiumSince > 0);
  assert.equal(after.lastPayment.amount, 1000);
  assert.equal(findAccount("donor_two").premium, true);
});

test("granting premium to a missing account is a no-op", () => {
  assert.equal(grantPremium("does_not_exist", { amount: 1000 }), null);
});
