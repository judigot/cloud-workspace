#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
ENV_FILE="${ROOT_DIR}/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ No .env found — run init.sh first" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

DOMAIN=${DOMAIN:-"judigot.com"}
OPENCODE_SUBDOMAIN=${OPENCODE_SUBDOMAIN:-"dev.${DOMAIN}"}
OPENCODE_PORT=${OPENCODE_PORT:-4097}

FAILURES=0

check() {
  local label="$1" url="$2" expect="$3"
  local code
  code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo "000")

  if echo "$code" | grep -qE "$expect"; then
    printf '  \033[0;32m✓\033[0m %-45s %s\n' "$label" "$code"
  else
    printf '  \033[0;31m✗\033[0m %-45s %s (expected %s)\n' "$label" "$code" "$expect"
    FAILURES=$((FAILURES + 1))
  fi
}

echo ""
echo "Health check"
echo ""

# Local opencode
check "localhost:${OPENCODE_PORT} (opencode direct)" \
  "http://127.0.0.1:${OPENCODE_PORT}" "200|401"

# HTTPS endpoints
check "https://${DOMAIN}" \
  "https://${DOMAIN}" "200|401"

check "https://${OPENCODE_SUBDOMAIN}" \
  "https://${OPENCODE_SUBDOMAIN}" "200|401"

# HTTP redirect
check "http://${DOMAIN} → HTTPS redirect" \
  "http://${DOMAIN}" "301"

# systemd service
if systemctl is-active --quiet opencode 2>/dev/null; then
  printf '  \033[0;32m✓\033[0m %-45s %s\n' "opencode.service" "active"
else
  printf '  \033[0;31m✗\033[0m %-45s %s\n' "opencode.service" "inactive"
  FAILURES=$((FAILURES + 1))
fi

# nginx
if systemctl is-active --quiet nginx 2>/dev/null; then
  printf '  \033[0;32m✓\033[0m %-45s %s\n' "nginx.service" "active"
else
  printf '  \033[0;31m✗\033[0m %-45s %s\n' "nginx.service" "inactive"
  FAILURES=$((FAILURES + 1))
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  printf '\033[0;32mAll checks passed\033[0m\n'
else
  printf '\033[0;31m%d check(s) failed\033[0m\n' "$FAILURES"
fi

exit "$FAILURES"
