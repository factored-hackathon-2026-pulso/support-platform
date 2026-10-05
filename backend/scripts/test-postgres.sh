#!/usr/bin/env bash
# Run the backend suite on a throwaway Postgres container (Docker or Podman).
#
#   scripts/test-postgres.sh                 # the whole suite
#   scripts/test-postgres.sh -k migrations   # any pytest arguments
#
# Env: CC_TEST_POSTGRES_IMAGE (default postgres:16-alpine), CONTAINER_ENGINE (docker | podman).
# The container gets a unique name, a random password and a random local port, and is
# removed on exit, also on failure or Ctrl+C. Already have a server? Skip this script:
#   CC_TEST_DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/postgres uv run pytest
set -euo pipefail

cd "$(dirname "$0")/.."
engine="${CONTAINER_ENGINE:-$(command -v docker >/dev/null 2>&1 && echo docker || echo podman)}"
image="${CC_TEST_POSTGRES_IMAGE:-postgres:16-alpine}"
name="cc-platform-test-pg-$$-$RANDOM"
password="$(openssl rand -hex 16)"

cleanup() { "$engine" rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

"$engine" run -d --name "$name" -e POSTGRES_PASSWORD="$password" -p 127.0.0.1::5432 \
  "$image" -c max_connections=200 -c fsync=off -c synchronous_commit=off -c full_page_writes=off \
  >/dev/null  # a disposable test server: durability off, much faster
port="$("$engine" port "$name" 5432/tcp | head -n1 | sed 's/.*://')"

for _ in $(seq 1 60); do
  if "$engine" exec "$name" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; then break; fi
  sleep 1
done
"$engine" exec "$name" pg_isready -U postgres -h 127.0.0.1 >/dev/null

echo "Postgres $image on 127.0.0.1:$port (container $name)"
CC_TEST_DATABASE_URL="postgresql://postgres:${password}@127.0.0.1:${port}/postgres" \
  uv run pytest "$@"
