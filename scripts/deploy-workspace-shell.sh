#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
ENV_FILE="${ROOT_DIR}/.env"

SOURCE_HTML="${ROOT_DIR}/workspace-shell/index.html"
TARGET_ROOT=${TARGET_ROOT:-"/var/www/workspace"}

# Load .env
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

DOMAIN=${DOMAIN:-"judigot.com"}
OPENCODE_SUBDOMAIN=${OPENCODE_SUBDOMAIN:-"dev.${DOMAIN}"}
VITE_APPS=${VITE_APPS:-"playground:5175 new-app:5176"}

# Build JSON array from VITE_APPS (slug:port pairs)
VITE_APPS_JSON="["
first=true
for app in $VITE_APPS; do
  slug=${app%%:*}
  port=${app##*:}
  if [ "$first" = true ]; then
    first=false
  else
    VITE_APPS_JSON="${VITE_APPS_JSON},"
  fi
  VITE_APPS_JSON="${VITE_APPS_JSON}{\"slug\":\"${slug}\",\"port\":${port}}"
done
VITE_APPS_JSON="${VITE_APPS_JSON}]"

# Inject values into template
TMP_FILE=$(mktemp)
sed \
  -e "s|@@DOMAIN@@|${DOMAIN}|g" \
  -e "s|@@OPENCODE_SUBDOMAIN@@|${OPENCODE_SUBDOMAIN}|g" \
  -e "s|@@VITE_APPS_JSON@@|${VITE_APPS_JSON}|g" \
  "$SOURCE_HTML" > "$TMP_FILE"

sudo mkdir -p "${TARGET_ROOT}"
sudo cp "$TMP_FILE" "${TARGET_ROOT}/index.html"
rm -f "$TMP_FILE"

echo "Deployed workspace shell to ${TARGET_ROOT}/index.html"
