import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
assert.equal(process.version, "v22.22.0", "Use Node from .nvmrc.");
process.loadEnvFile(".env");
process.loadEnvFile(".env.local");
assert(
  ["localhost", "127.0.0.1"].includes(
    new URL(process.env.NEXT_PUBLIC_CONVEX_URL).hostname,
  ),
  "Use a local deployment.",
);
const names = [
  "CLERK_JWT_ISSUER_DOMAIN",
  "CONVEX_TO_N8N_SECRET",
  "N8N_TO_CONVEX_SECRET",
  "N8N_NOTIFY_URL",
];
try {
  for (const name of names) {
    assert(process.env[name], `Configure ${name} before continuing.`);
    execFileSync("npx", ["convex", "env", "set", name, process.env[name]], {
      stdio: "pipe",
    });
  }
  execFileSync(
    "npx",
    ["convex", "env", "set", "APP_TIMEZONE", process.env.APP_TIMEZONE ?? "UTC"],
    { stdio: "pipe" },
  );
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      execFileSync("npx", ["convex", "run", "clock:tick"], { stdio: "pipe" });
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  assert(ready, "Wait for the watching terminal to finish deployment.");
  console.log(
    "Backend environment configured and calendar refreshed. Private values were not printed.",
  );
} catch {
  console.error(
    "Configuration failed. Check the named environment fields and ensure local Convex is running.",
  );
  process.exitCode = 1;
}
