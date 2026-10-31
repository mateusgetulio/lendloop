// Development-only check: create a temporary Clerk user/session, test, then delete.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

process.loadEnvFile(".env.local");
const secret = process.env.CLERK_SECRET_KEY;
assert(secret?.startsWith("sk_test_"), "Use a Clerk development key only");
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
assert(
  url && ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
  "This check is for local Convex only",
);
const identity = makeFunctionReference("users:current");
let stage = "setup";
async function clerk(path, method = "POST", body = {}) {
  const response = await fetch(`https://api.clerk.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    ...(method === "DELETE" ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const code = failure.errors?.[0]?.code;
    throw new Error(
      `Clerk development probe failed: HTTP ${response.status}; code ${typeof code === "string" && /^[a-z0-9_]{1,80}$/.test(code) ? code : "unavailable"}`,
    );
  }
  return response.json();
}
let userId;
try {
  const anonymous = new ConvexHttpClient(url, { logger: false });
  assert.equal((await anonymous.query(identity, {})).authenticated, false);
  console.log("PASS: anonymous local Convex request has no identity");
  stage = "create temporary user";
  const user = await clerk("/users", "POST", {
    email_address: [`lendloop-check-${randomUUID()}+clerk_test@example.com`],
    skip_password_requirement: true,
  });
  userId = user.id;
  stage = "create development session";
  const session = await clerk("/sessions", "POST", { user_id: userId });
  stage = "issue Clerk session token";
  const { jwt } = await clerk(`/sessions/${session.id}/tokens`);
  assert.equal(typeof jwt, "string");
  const client = new ConvexHttpClient(url, { logger: false });
  client.setAuth(jwt);
  await client.mutation(makeFunctionReference("users:ensureCurrent"), {});
  const result = await client.query(identity, {});
  assert.equal(result.authenticated, true);
  assert.equal(typeof result.user?.displayName, "string");
  console.log(
    "PASS: real Clerk-issued session token with Convex audience authenticates against local Convex",
  );
  console.log("PASS: authenticated profile is provisioned with a display name");
  const pieces = jwt.split(".");
  const signature = Buffer.from(pieces[2], "base64url");
  signature[0] ^= 1;
  pieces[2] = signature.toString("base64url");
  client.setAuth(pieces.join("."));
  let rejected = false;
  try {
    rejected = !(await client.query(identity, {})).authenticated;
  } catch {
    rejected = true;
  }
  assert(rejected, "Tampered Clerk token must not authenticate");
  console.log("PASS: tampered Clerk token is rejected");
} catch (error) {
  // Do not print SDK error objects, environment values, JWTs, or response bodies.
  console.error("Failed stage: " + stage);
  console.error(
    error instanceof Error &&
      /^(Clerk development probe failed|Use a Clerk|This check)/.test(
        error.message,
      )
      ? error.message
      : "Clerk identity probe failed; inspect configuration without logging credentials",
  );
  process.exitCode = 1;
} finally {
  if (userId) {
    try {
      await clerk(`/users/${userId}`, "DELETE");
      console.log("PASS: temporary Clerk user and its sessions removed");
    } catch {
      console.error(
        "Temporary Clerk user cleanup failed; remove the test user in the development dashboard",
      );
      process.exitCode = 1;
    }
  }
}
