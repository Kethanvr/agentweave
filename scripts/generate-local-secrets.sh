#!/usr/bin/env bash
set -euo pipefail

if [[ -f .secrets ]]; then
  echo ".secrets already exists; leaving it unchanged."
  exit 0
fi

private_key=$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null)
public_key=$(printf '%s\n' "$private_key" | openssl pkey -pubout 2>/dev/null)
jwt_kid=$(node -e 'console.log(crypto.randomUUID().toUpperCase())')

escape_key() {
  printf '%s' "$1" | awk 'BEGIN { ORS="" } { if (NR > 1) printf "\\n"; printf "%s", $0 }'
}

private_escaped=$(escape_key "$private_key")
public_escaped=$(escape_key "$public_key")

umask 077
{
  printf "GRAFANA_ADMIN_PASSWORD = 'grafana-admin-password'\n"
  printf "GEMINI_API_KEY = 'replace-with-gemini-key'\n"
  printf "HASURA_GRAPHQL_ADMIN_SECRET = 'nhost-admin-secret'\n"
  printf "NHOST_JWT_KID = '%s'\n" "$jwt_kid"
  printf 'NHOST_JWT_PRIVATE_KEY = "%s"\n' "$private_escaped"
  printf 'NHOST_JWT_PUBLIC_KEY = "%s"\n' "$public_escaped"
  printf "NHOST_WEBHOOK_SECRET = 'nhost-webhook-secret'\n"
  printf "RESEND_API_KEY = 'replace-with-resend-key'\n"
} > .secrets

echo "Created local-only .secrets with a fresh JWT key pair."
