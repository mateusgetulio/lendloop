// Temporary signing check for both receivers. Reads ignored .env; never prints secrets.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const unicode = "Neighborhood café tool\nsecond line";
const value = { spike: true, message: unicode };

function sign(secret, timestamp, purpose, payload) {
  return (
    "v1=" +
    createHmac("sha256", secret)
      .update(`v1\n${timestamp}\n${purpose}\n${payload}`)
      .digest("hex")
  );
}

async function send(url, purpose, secret, input, options = {}) {
  const payload = JSON.stringify(input);
  const now = Math.floor(Date.now() / 1000);
  const timestamp = String(now + (options.offsetSeconds ?? 0));
  const signature = options.malformed
    ? "v1=not-hex"
    : options.zeroSignature
      ? "v1=" + "0".repeat(64)
      : sign(secret, timestamp, purpose, payload);
  const sent = options.changePayload
    ? payload.replace("café", "cafe")
    : payload;
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LendLoop-Timestamp": timestamp,
      "X-LendLoop-Signature": signature,
    },
    body: JSON.stringify({
      payload: options.oversized ? "x".repeat(70000) : sent,
      ...(options.extra ? { unexpected: true } : {}),
    }),
  });
}

const n8n = "http://localhost:5678/webhook/lendloop-notify";
const convex = "http://127.0.0.1:3211/automation/notifications";

if (process.argv.includes("--force-error")) {
  const result = await send(n8n, "notify", env.CONVEX_TO_N8N_SECRET, {
    ...value,
    forceFailure: true,
  });
  console.log("Intentional production webhook error status:", result.status);
} else {
  const valid = await send(n8n, "notify", env.CONVEX_TO_N8N_SECRET, value);
  assert.equal(valid.status, 200);
  const body = await valid.json();
  assert.equal(body.verified, true);
  assert.equal(body.message, unicode);
  console.log("PASS signed n8n to Convex callback, Unicode and newline exact");

  const receivers = [
    ["n8n", n8n, "notify", env.CONVEX_TO_N8N_SECRET, env.N8N_TO_CONVEX_SECRET],
    [
      "Convex",
      convex,
      "notification-result",
      env.N8N_TO_CONVEX_SECRET,
      env.CONVEX_TO_N8N_SECRET,
    ],
  ];
  for (const [name, url, purpose, secret, otherSecret] of receivers) {
    const cases = [
      ["zero signature", purpose, secret, { zeroSignature: true }, 401],
      ["malformed signature", purpose, secret, { malformed: true }, 401],
      ["changed payload", purpose, secret, { changePayload: true }, 401],
      ["wrong purpose", "wrong-purpose", secret, {}, 401],
      ["other direction's secret", purpose, otherSecret, {}, 401],
      ["stale timestamp", purpose, secret, { offsetSeconds: -600 }, 401],
      ["future timestamp", purpose, secret, { offsetSeconds: 600 }, 401],
      ["extra envelope field", purpose, secret, { extra: true }, 400],
      ["oversized body", purpose, secret, { oversized: true }, 413],
    ];
    for (const [label, usedPurpose, usedSecret, options, status] of cases) {
      const response = await send(url, usedPurpose, usedSecret, value, options);
      assert.equal(response.status, status, `${name} ${label}`);
      console.log(`PASS ${name} rejects ${label} with ${status}`);
    }
  }
}
