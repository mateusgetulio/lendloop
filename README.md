# LendLoop

A neighborhood tool-lending board. **This is the foundation build: the lending product isn't here yet.** What exists today is the project setup, a sign-in check, CI, and a working proof of the signed connection between Convex and n8n. The workflows are temporary probes, and the overdue export is an inactive placeholder.

- `DECISIONS.md`: front-end decisions and the research behind them.
- `docs/verification.md`: what has been tested, the results, and what hasn't been tested yet.

## Prerequisites

Node from `.nvmrc`, npm, Docker Compose, and your own Clerk development application with the Convex integration activated.

```sh
nvm install
nvm use
npm ci
cp .env.example .env
```

Generate three separate values with `openssl rand -hex 32` for `N8N_ENCRYPTION_KEY`, `CONVEX_TO_N8N_SECRET` and `N8N_TO_CONVEX_SECRET`, and put them in `.env`. Keep the encryption key stable, because the n8n volume depends on it.

## Run it

Start Convex in its own terminal and leave it running:

```sh
CONVEX_AGENT_MODE=anonymous npx convex dev
```

This creates `.env.local` with the local URLs (`3210` for the client, `3211` for HTTP actions). Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` and `CLERK_JWT_ISSUER_DOMAIN` to it, then set the backend's environment:

```sh
npx convex env set CLERK_JWT_ISSUER_DOMAIN <your-clerk-issuer>
npx convex env set CONVEX_TO_N8N_SECRET <value-from-.env>
npx convex env set N8N_TO_CONVEX_SECRET <value-from-.env>
npx convex env set N8N_NOTIFY_URL http://localhost:5678/webhook/lendloop-notify
```

Without the issuer, Convex has no auth provider and every request is anonymous.

Then start n8n and the app:

```sh
docker compose up -d
sh scripts/n8n-setup.sh
npm run dev
```

The script imports the workflows into this project's own Docker volume, publishes them, and restarts n8n. Repeat runs overwrite the same workflow IDs, so never point it at an n8n instance holding other work. Opening `http://localhost:5678` the first time shows n8n's owner account screen.

Docker reaches Convex at `host.docker.internal:3211`, and Convex reaches n8n at `localhost:5678`. The host-gateway entry is there for Linux, but this has only been tested on macOS with OrbStack.

## Check the integration

With everything running:

```sh
node scripts/spike.mjs
node scripts/check-clerk.mjs
npx convex run spike:roundTrip
node scripts/spike.mjs --force-error
```

- `spike.mjs` sends valid and invalid signed requests to both n8n and Convex.
- `check-clerk.mjs` creates a temporary Clerk development user, tests a real session token against local Convex, then deletes the user. It refuses production keys and never prints secrets.
- `spike:roundTrip` starts a signed request from inside Convex and follows it through n8n and back.
- `--force-error` should return HTTP 500. Check n8n's Executions tab for the failed run and the error workflow run that follows it, and check the Convex logs for the failure report.

## Security boundary

Requests use a signed string envelope, with one HMAC-SHA256 secret for each direction, constant-time verification, a five-minute timestamp window and a 64 KiB limit.

To make this work, n8n Code nodes are allowed to read environment variables and use Node's `crypto` module. **Anyone who can edit workflows on this instance can read its secrets.** That's acceptable for a local demo holding throwaway secrets and bound to loopback, and it isn't how this should run in production. n8n also warns on startup that internal runner mode is deprecated.

Executions are pruned after seven days. `.env.ci` is safe to publish: it holds a made-up publishable key and a placeholder URL.

## Checks

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run check:workflows
docker compose config -q
```

CI runs these on every push, along with a production build using `.env.ci` and a Gitleaks scan of the full git history. `npm audit` runs too, but only as a report. Actions and the Gitleaks download are pinned.

**A green badge doesn't cover sign-in, workflow runs or concurrency.** Those need Clerk, Convex and n8n running, so they're checked with the commands above and recorded in `docs/verification.md`.
