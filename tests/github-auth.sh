#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
CONFIG_PATH="${TMP_DIR}/nginx.conf"

cat > "$CONFIG_PATH" <<'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

upstream opencode_backend {
    server 127.0.0.1:4097;
}

server {
    listen 443 ssl;
    server_name dev.judigot.com;

    location / {
        proxy_pass http://opencode_backend;
    }
}
EOF

DOMAIN=judigot.com \
OPENCODE_SUBDOMAIN=dev.judigot.com \
WORKSPACE_AUTH_PROVIDER=github \
OAUTH2_PROXY_BACKEND=127.0.0.1:4180 \
bash "${ROOT_DIR}/scripts/apply-github-auth.sh" "$CONFIG_PATH"

grep -Fq 'upstream oauth2_proxy_backend {' "$CONFIG_PATH"
grep -Fq 'auth_request /oauth2/auth;' "$CONFIG_PATH"
grep -Fq 'location /oauth2/ {' "$CONFIG_PATH"
grep -Fq 'location = /oauth2/auth {' "$CONFIG_PATH"
grep -Fq 'proxy_pass http://oauth2_proxy_backend/oauth2/auth;' "$CONFIG_PATH"

UNMODIFIED_PATH="${TMP_DIR}/unmodified.conf"
printf '%s\n' 'server { }' > "$UNMODIFIED_PATH"
WORKSPACE_AUTH_PROVIDER=nginx bash "${ROOT_DIR}/scripts/apply-github-auth.sh" "$UNMODIFIED_PATH"
grep -Fxq 'server { }' "$UNMODIFIED_PATH"

# The GitHub bootstrap must keep init.sh attached to the SSH terminal so the
# existing DNS mismatch prompt can wait and retry instead of exiting.
if grep -Eq "printf .*\|[[:space:]]*bash .*init\.sh" "${ROOT_DIR}/scripts/init-github.sh"; then
  echo "init-github.sh must not pipe input into init.sh" >&2
  exit 1
fi
grep -Fq 'if [ ! -t 0 ]; then' "${ROOT_DIR}/scripts/init-github.sh"
grep -Fq 'bash "${SCRIPT_DIR}/init.sh"' "${ROOT_DIR}/scripts/init-github.sh"

echo "GitHub authentication integration tests passed"
