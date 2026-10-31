# LendLoop

A neighborhood tool-lending board. Neighbors can list tools, request dates, approve or decline requests, cancel future reservations, and confirm returns. Administrators can remove any listing, view all loans, and mark Trusted Lenders.

The automation connection is still a temporary signed round-trip proof. Changes create pending event records, but nothing dispatches them yet. Notifications, reminders, the automation dashboard and a repeatable demo seed are not implemented.

- `DECISIONS.md`: front-end choices and their sources.
- `docs/verification.md`: checks performed, results and limitations.

## Prerequisites

Use Node 22.22.0 from `.nvmrc` and npm 10.9.4. The lockfile must only be changed with that exact pair. Docker Compose and a Clerk development application with the Convex integration activated are also required.

```sh
nvm install
nvm use
node --version
npm --version
npm ci
cp .env.example .env
```

Generate independent values with `openssl rand -hex 32` for `N8N_ENCRYPTION_KEY`, `CONVEX_TO_N8N_SECRET` and `N8N_TO_CONVEX_SECRET`. Keep these in `.env`, and keep the encryption key stable for the persistent n8n volume.

## Run it

Start Convex and leave it running:

```sh
CONVEX_AGENT_MODE=anonymous npx convex dev
```

The CLI creates `.env.local` with local URLs, port 3210 for the client and 3211 for HTTP actions. Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` and `CLERK_JWT_ISSUER_DOMAIN` to that file. Public-prefixed values must contain only public configuration.

Configure the backend separately:

```sh
npx convex env set CLERK_JWT_ISSUER_DOMAIN <your-clerk-issuer>
npx convex env set APP_TIMEZONE UTC
npx convex env set CONVEX_TO_N8N_SECRET <value-from-.env>
npx convex env set N8N_TO_CONVEX_SECRET <value-from-.env>
npx convex env set N8N_NOTIFY_URL http://localhost:5678/webhook/lendloop-notify
npx convex run clock:tick
npm run dev
```

Keep `APP_TIMEZONE` consistent between Convex and Docker configuration. It defaults to UTC. The calendar refreshes every minute; the initial tick avoids waiting for the first refresh. Queries use this stored date, while mutations recheck dates against the actual clock in the configured timezone.

Open `http://localhost:3000`. The public query returns only tool names and categories. Sign in to browse details or lend and borrow. Account provisioning is idempotent and gives every new account the ordinary user role. Clerk session tokens carry no name by default, so accounts show as `Neighbor`. To show real names, Clerk lets you add a `name` claim to the session token. That setup has not been tested here. Admins can still tell accounts apart, because each one lists its active tools.

## Lending rules

Dates are inclusive, so two reservations sharing a boundary date overlap. Pending requests do not reserve a tool. Approval rechecks conflicts transactionally. Duplicate overlapping requests by the same borrower are rejected. An overdue outstanding loan prevents new requests and approvals until return.

The borrower can cancel a pending request. Either participant can cancel an approved reservation before its start date. Once it starts, only the lender can confirm return. A pending request whose start date has passed cannot be approved.

Owners can edit only their own active listings. They cannot delete one with a started outstanding loan. Administrators can remove any listing. Removal preserves history, declines pending requests, cancels future approved loans, and leaves started loans returnable. Every actual request/status change writes its pending automation event in the same transaction. Repeating a completed transition adds no event.

Availability badges mean today, not every future date. Busy ranges on the detail page reveal no borrower identity. Category filters live in the URL and survive the Back button.

## Administrator setup

Sign in once to create the local user profile. Open the local Convex dashboard and find the intended account in `users`, matching its Clerk subject against `tokenIdentifier`. Copy its local `_id`, then run:

```sh
npx convex run admin:promote '{"userId":"<local-user-id>"}'
```

This is an internal developer operation, not a browser-callable promotion endpoint. The Admin destination appears for that account. Trusted Lender is only a badge and never grants permissions.

## Temporary automation connection

```sh
docker compose up -d
sh scripts/n8n-setup.sh
node scripts/spike.mjs
node scripts/check-clerk.mjs
npx convex run spike:roundTrip
node scripts/spike.mjs --force-error
```

Workflow import targets the dedicated project volume and fixed IDs. Repeating it overwrites those IDs, so never use an instance holding unrelated work. The first visit to `http://localhost:5678` shows n8n's owner screen. The overdue export stays inactive.

Docker reaches the backend at `host.docker.internal:3211`; the backend reaches n8n through `localhost:5678`. The Linux host-gateway entry is configured but integration networking has only been exercised on macOS with OrbStack.

The signing script tests valid delivery and nine rejection cases per receiver. The Clerk script creates a temporary development account, verifies a real session token through the account query, provisions the profile, checks a modified token is rejected, then deletes the Clerk account and sessions. Local profile/history deletion is not implemented, so its synthetic profile remains locally. No secrets or tokens are printed. It refuses production Clerk keys and non-loopback backends.

The forced-error command should return HTTP 500. Inspect the failed production execution and the successful error workflow that follows it. These probes do not deliver product notifications, deduplicate callbacks or run reminders.

## Security and architecture

The browser uses Clerk session tokens with Convex audience. Every authenticated public operation resolves its actor from verified auth. Domain helpers take the resolved local actor ID, allowing business rules to be exercised without accepting actor or role arguments from browsers. Admin checks and ownership rules run in Convex, not just in the interface.

Listing and loan reads are paginated. The public projection excludes internal IDs and all owner details. Signed-in tool detail exposes busy dates without borrowers. Removed listings use soft deletion and loans retain immutable tool-name snapshots. User text is rendered as text.

The temporary integration uses a string envelope, directional HMAC-SHA256 secrets, constant-time verification, a five-minute clock window and 64 KiB checks. Trusted n8n Code nodes can read the instance environment and Node crypto. Anyone who can edit a workflow can read its secrets. This dedicated, loopback-bound mock-data instance is not production hardening. Execution retention is seven days and internal runners emit a deprecation warning.

Before production: isolate workflow runners, restrict access, use managed secrets and rotation, enable HTTPS throughout, add external monitoring, rate limits, backups and retention policies, and use a notification provider with an explicit duplicate-delivery policy.

## Checks

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run check:workflows
docker compose config -q
npm audit --audit-level=high
```

The test suite covers verified-actor boundaries, permissions, date validation, transitions, event atomicity, soft removal, clock boundaries and token contrast. CI runs it on every push, and dependencies are pinned exactly. Production compilation works with fictional public values in `.env.ci`, without a secret Clerk key or running backend.

CI uses full-SHA-pinned actions, the Node version file, `npm ci`, and a checksum-pinned Gitleaks binary scanning full history. Audit is report-only. Generated Convex types are checked in so type checks need no backend.

**A green badge does not cover browser sign-in, workflow executions or real concurrency.** Those need running services. Chromium sign-in, screen sizes, keyboard use and live backend checks are recorded separately in `docs/verification.md`. Real concurrent approvals and complete automation reliability remain unverified.
