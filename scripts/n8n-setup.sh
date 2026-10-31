#!/bin/sh
set -eu
# Dedicated project volume only. The overdue file is an inactive placeholder.
docker compose exec -T n8n n8n import:workflow --separate --input=/workflows
docker compose exec -T n8n n8n publish:workflow --id=LendLoopErrorM1
docker compose exec -T n8n n8n publish:workflow --id=LendLoopNotifyM1
# Restart the server to load CLI-published versions.
docker compose restart n8n
