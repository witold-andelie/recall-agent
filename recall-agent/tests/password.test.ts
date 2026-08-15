import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hashPassword,
  parseUsernamePassword,
  verifyPassword,
} from "../src/lib/session/password.ts";

test("parseUsernamePassword rejects bad usernames and short passwords", () => {
  assert.equal(
    "error" in parseUsernamePassword({ username: "Ada", password: "longenough" }),
    false,
  );
  assert.equal(
    "error" in parseUsernamePassword({ username: "1bad", password: "longenough" }),
    true,
  );
  assert.equal(
    "error" in parseUsernamePassword({ username: "ok_name", password: "short" }),
    true,
  );
});

test("parseUsernamePassword lowercases username", () => {
  const parsed = parseUsernamePassword({
    username: "Ada_Lovelace",
    password: "hackathon",
    displayName: " Ada ",
  });
  assert.equal("error" in parsed, false);
  if ("error" in parsed) return;
  assert.equal(parsed.username, "ada_lovelace");
  assert.equal(parsed.displayName, "Ada");
});

test("hashPassword then verifyPassword round-trips", async () => {
  const stored = await hashPassword("correct horse");
  assert.equal(await verifyPassword("correct horse", stored), true);
  assert.equal(await verifyPassword("wrong horse", stored), false);
});
