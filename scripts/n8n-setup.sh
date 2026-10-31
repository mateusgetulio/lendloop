#!/bin/sh
set -eu
# Dedicated project volume only. Stop all existing schedules before replacing definitions.
docker compose exec -T n8n n8n unpublish:workflow --all
docker compose exec -T n8n n8n import:workflow --separate --input=/workflows
docker compose exec -T n8n n8n publish:workflow --id=LendLoopError
docker compose exec -T n8n n8n publish:workflow --id=LendLoopOverdue
docker compose exec -T n8n n8n publish:workflow --id=LendLoopNotify
# Restart the server to load CLI-published versions.
docker compose restart n8n
