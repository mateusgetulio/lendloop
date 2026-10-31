#!/bin/sh
set -eu
wait_for_n8n() {
node --input-type=module <<'JS'
if (process.version !== "v22.22.0") throw new Error("Use Node from .nvmrc.");
let ready = false;
for (let attempt = 0; attempt < 120; attempt++) {
  try { if ((await fetch("http://localhost:5678/healthz/readiness", { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 1000));
}
if (!ready) { console.error("n8n is not ready. Start Docker Compose and check its initialization logs."); process.exit(1); }
JS
}
wait_for_n8n
# Dedicated project volume only. Stop all existing schedules before replacing definitions.
docker compose exec -T n8n n8n unpublish:workflow --all
docker compose exec -T n8n n8n import:workflow --separate --input=/workflows
docker compose exec -T n8n n8n publish:workflow --id=LendLoopError
docker compose exec -T n8n n8n publish:workflow --id=LendLoopOverdue
docker compose exec -T n8n n8n publish:workflow --id=LendLoopNotify
# Restart the server to load CLI-published versions.
docker compose restart n8n
wait_for_n8n
