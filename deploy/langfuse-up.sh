#!/bin/sh
# Starts a local Langfuse from its official compose file and prints how to point the app at it.
# Secrets are generated once into deploy/langfuse.env, which is git-ignored.
set -e
cd "$(dirname "$0")"
ENV_FILE=langfuse.env
if [ ! -f "$ENV_FILE" ]; then
  rand() { openssl rand -hex "$1"; }
  umask 077
  cat > "$ENV_FILE" <<ENV
ENCRYPTION_KEY=$(rand 32)
SALT=$(rand 16)
NEXTAUTH_SECRET=$(rand 16)
POSTGRES_PASSWORD=$(rand 12)
CLICKHOUSE_PASSWORD=$(rand 12)
MINIO_ROOT_PASSWORD=$(rand 12)
LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY=$(rand 12)
LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY=$(rand 12)
LANGFUSE_S3_BATCH_EXPORT_SECRET_ACCESS_KEY=$(rand 12)
REDIS_AUTH=$(rand 12)
LANGFUSE_INIT_ORG_ID=triage-local
LANGFUSE_INIT_ORG_NAME=local
LANGFUSE_INIT_PROJECT_ID=triage
LANGFUSE_INIT_PROJECT_NAME=withdrawal-triage
LANGFUSE_INIT_PROJECT_PUBLIC_KEY=pk-lf-$(rand 8)
LANGFUSE_INIT_PROJECT_SECRET_KEY=sk-lf-$(rand 16)
LANGFUSE_INIT_USER_EMAIL=local@example.com
LANGFUSE_INIT_USER_NAME=local
LANGFUSE_INIT_USER_PASSWORD=$(rand 12)
ENV
  echo "Generated deploy/$ENV_FILE"
fi
. "./$ENV_FILE"
# MinIO's root password must match the S3 secret keys the app uses.
export MINIO_ROOT_PASSWORD="$LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY"
export DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/postgres"
./compose.sh -p langfuse --env-file "$ENV_FILE" -f langfuse.compose.upstream.yaml -f langfuse.override.yaml up -d "$@"

AUTH=$(printf '%s:%s' "$LANGFUSE_INIT_PROJECT_PUBLIC_KEY" "$LANGFUSE_INIT_PROJECT_SECRET_KEY" | base64)
echo
echo "Langfuse UI: http://localhost:3001  (login details are in deploy/$ENV_FILE)"
echo "Point the app at it:"
echo "  export OTLP_ENDPOINT=http://localhost:3001/api/public/otel"
echo "  export OTLP_HEADERS=\"authorization=Basic $AUTH,x-langfuse-ingestion-version=4\""
