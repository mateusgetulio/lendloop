# Verification

Date: 2026-10-31. Scope: the foundation build and integration proof only. No product tables, listings, loans, role management, notification persistence, or reminder scheduling have been implemented.

## Runtime versions

| Component            | Version                         |
| -------------------- | ------------------------------- |
| Node / npm           | 22.22.0 / 10.9.4, from `.nvmrc` |
| Next.js              | 16.4.3                          |
| React / React DOM    | 19.2.3                          |
| TypeScript           | 5.9.3                           |
| Convex client/CLI    | 1.49.0                          |
| Clerk Next.js SDK    | 7.9.23                          |
| n8n Docker image     | `n8nio/n8n:2.45.7`              |
| Vitest / Vite        | 5.0.5 / 8.3.5                   |
| Prettier             | 3.9.10                          |
| ESLint               | 9.39.5                          |
| Local secret scanner | Gitleaks 8.30.1                 |

Integration checks ran on macOS arm64 with Docker through OrbStack. The install, type check, lint, format, test, build and audit steps also ran in a clean `node:22.22.0` Linux container using npm 10.9.4. The first CI run failed at `npm ci` because the lockfile had been generated with a different npm, so it was regenerated with this version. Change the lockfile only with the Node and npm from `.nvmrc`. Linux networking for n8n is configured but has not been exercised. Package versions are locked by `package-lock.json`.

## Integration checks

| Check                                                                               | Result                   | Evidence and interpretation                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| n8n Code nodes can read directional secrets                                         | PASS                     | The published notification workflow verified a request using its environment secret, then signed a callback with the independent reverse-direction secret. No secret values were embedded in the exported workflows.                                                                                                               |
| n8n can calculate HMAC and compare signatures in constant time                      | PASS                     | `require('crypto')`, HMAC-SHA256, and `timingSafeEqual` executed successfully in the internal JavaScript task runner. Tampered signatures were rejected.                                                                                                                                                                           |
| The signed string envelope survives webhook parsing                                 | PASS                     | A message containing an accented character, an emoji and an escaped newline completed the round trip unchanged. The receiver used `body.payload` directly; no raw-body fallback was needed.                                                                                                                                        |
| An invalid signature returns unauthorized before later processing                   | PASS                     | Invalid requests returned HTTP 401. Execution records showed only Webhook → Verify → Valid → Reject, with neither Sign callback nor Callback executed. Extra outer fields returned HTTP 400.                                                                                                                                       |
| Convex HTTP actions can verify HMAC with Web Crypto                                 | PASS                     | The actual HTTP action verified the n8n callback through `crypto.subtle.verify`. Tampered signatures, expired timestamps and wrong endpoint purposes were rejected. No Node-action fallback was required.                                                                                                                          |
| Local Convex supports environment configuration and real Clerk authentication       | PASS                     | Backend environment updates succeeded. A real Clerk-issued development session token authenticated through `ConvexHttpClient` against the local backend. An anonymous request had no identity; a modified token was rejected. HTTP actions were exercised on port 3211.                                                            |
| Docker n8n and local Convex can reach each other                                    | PASS                     | `npx convex run spike:roundTrip` originated a signed request in the backend, reached the published n8n webhook through host loopback, and received its verified callback through Docker's host gateway. No cloud or tunnel fallback was used.                                                                                      |
| Workflows can be imported, published and invoke an error workflow on a real failure | PASS                     | Three fixed-ID workflows imported successfully. Notification and error probes published through the CLI and loaded after restarting n8n. An intentional failure in a production webhook execution triggered a successful error workflow and a verified `failure-report` callback. No manual reference-mapping fallback was needed. |
| Clerk identity has a usable display-name strategy                                   | PASS WITH NAMED FALLBACK | The temporary test user had no profile name. The authenticated query returned `hasUsableName: false` and `displayNameFallback: "Neighbor"`. This proves the fallback; it does not claim a positive profile-name claim was observed.                                                                                                |

The local backend used the primary deployment approach. The only named fallback used was the `Neighbor` display name.

## Real Clerk-token test

A Clerk development app is configured in `.env.local`. Its issuer was set separately on the local Convex deployment; frontend environment files alone do not configure backend authentication.

`node scripts/check-clerk.mjs` performed the following checks:

1. Called the identity query anonymously and observed `authenticated: false`.
2. Created a uniquely named temporary development test user and an active development session through the Clerk Backend API.
3. Obtained a real short-lived session JWT from Clerk and submitted it directly to local Convex.
4. Observed `authenticated: true` and the `Neighbor` name fallback.
5. Changed a byte of the token signature and confirmed it could not authenticate.
6. Deleted the temporary Clerk user and its associated sessions in a cleanup block.

The successful run exited zero. The secret key, JWT, user identifier and email were not printed or saved in this document. The probe refuses production Clerk keys and non-loopback Convex URLs.

An initial attempt to request a legacy token template named `convex` returned HTTP 404. The configured integration uses ordinary session tokens with the Convex audience instead. The probe was corrected to use the session-token endpoint, matching the current integration path supported by the installed Convex Clerk provider. No app configuration, authentication audience or provider was weakened to make the test pass. Temporary users from unsuccessful attempts were also deleted.

This is a real issuer/signature/audience validation test, not an impersonated actor or mocked JWT. It does not claim a browser sign-in walkthrough, role authorization, or product provisioning has been completed.

## Signed workflow execution checks

Commands executed with Docker n8n and local Convex running:

```sh
node scripts/spike.mjs
npx convex run spike:roundTrip
node scripts/spike.mjs --force-error
```

Valid delivery kept Unicode and newlines exact. Both receivers returned 401 for a zero signature, a malformed signature, a changed payload with its original signature, a wrong purpose, the other direction's secret, and timestamps ten minutes old or ahead. Both returned 400 for an extra envelope field and 413 for a body over 64 KiB. The backend-originated round trip returned `verified: true` and the original message.

The deliberate error command returned HTTP 500 as expected. Inspection of n8n execution records showed a failed notification execution ending in Sign callback, followed by a successful error execution containing Error Trigger → Sign failure → Report failure. Convex logged `M1 verified failure-report`. Earlier attempts made before backend HTTP actions compiled failed as expected and remain distinguishable from the successful execution.

These are temporary integration probes. They validate transport and rejection paths, not product idempotency or the full production event schema. The overdue file is an inactive structural fixture; it sends no reminders. The final workflow files were exported from the actual n8n instance, stripped of instance-history metadata and `pinData`, and checked for credential values.

## Local quality and CI-equivalent checks

| Check                                                                                                        | Result                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Clean source copy with only public CI configuration, then `npm ci`                                           | PASS                                                                                    |
| TypeScript check, `npm run typecheck`                                                                        | PASS                                                                                    |
| ESLint including recommended accessibility rules, `npm run lint`                                             | PASS                                                                                    |
| Formatting, `npm run format:check`                                                                           | PASS                                                                                    |
| Design-token contrast, `npm test`                                                                            | PASS: 13 checks across all documented text, button, border, focus and badge color pairs |
| Production compilation, `npm run build` with fictional public Clerk configuration and placeholder Convex URL | PASS: no Clerk secret or running backend required                                       |
| Workflow JSON/IDs/error references/secret patterns/pinned image, `npm run check:workflows`                   | PASS                                                                                    |
| Compose interpolation and structure, `docker compose config -q`                                              | PASS                                                                                    |
| Dependency audit, `npm audit --audit-level=high`                                                             | PASS at the requested threshold; 14 moderate findings remain in lint-tool dependencies  |
| Gitleaks scan of proposed repository files, including untracked source                                       | PASS, no leaks; exact fictional public CI key has a narrow allowlist                    |
| `DECISIONS.md` matches its source document                                                                   | PASS, unchanged                                                                         |
| Secret values from local environment files searched for in every committed file                              | PASS: no matches                                                                        |

The first test-runner versions tried had critical advisories, so they were replaced with the pinned Vitest and Vite versions above. TypeScript is pinned to a version supported by the installed lint toolchain. The remaining audit findings are reported rather than suppressed or bypassed with forced major dependency downgrades.

The clean-copy run checked the offline pipeline, not a full-product fresh clone. Generated Convex types are committed so type checks need no backend. Actions in CI are pinned to full commit SHAs, the Gitleaks download is pinned by checksum, Node comes from `.nvmrc`, and the secret scan covers the full git history.

Hosted CI results are in the repository's Actions tab. A green run does not cover anything that needs Clerk, Convex and n8n running.

## Boundaries and remaining work

- The product UI does not exist yet, so the decisions in `DECISIONS.md` have not been checked against real screens. Only the identity check and shared design tokens exist.
- Sign-in has been tested with a real Clerk session token, but not yet by clicking through it in a browser.
- No complete product acceptance case is claimed. Signing and real error-workflow portions have been demonstrated, but durable notification insertion, participant routing, idempotency, admin failure visibility, loan races and daily reminders remain unimplemented.
- The dedicated n8n instance allows environment access to trusted workflow editors. Its internal JavaScript runner is suitable only for this isolated mock-data proof. Startup warns about deprecated internal mode and a missing Python runner; no Python workflows exist.
- The HTTP probes check size, envelope shape, signatures and minimal spike payloads. They are not a finished production validation or replay-deduplication layer.
- Secrets stay in ignored environment/runtime files. Cached tooling and generated inspection artifacts stay under ignored `.cache/`.

## Reference documentation used

Runtime checks above are the evidence. Documentation informed setup and test access:

- [Convex local development](https://docs.convex.dev/cli/local-deployments)
- [Convex with Clerk](https://docs.convex.dev/auth/clerk)
- [Clerk with Convex](https://clerk.com/docs/guides/development/integrations/databases/convex)
- [Clerk testing and real session tokens](https://clerk.com/docs/guides/development/testing/overview)
- [n8n task runners and their trust boundary](https://docs.n8n.io/hosting/configuration/task-runners/)
