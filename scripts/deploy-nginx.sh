#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
ENV_FILE="${ROOT_DIR}/.env"

# Source .env so generate-nginx.sh picks up APPS, DOMAIN, etc.
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

OPENCODE_HTPASSWD_FILE=${OPENCODE_HTPASSWD_FILE:-"/etc/nginx/.htpasswd-opencode"}
WORKSPACE_AUTH_USERNAME=${WORKSPACE_AUTH_USERNAME:-${OPENCODE_SERVER_USERNAME:-""}}
WORKSPACE_AUTH_PASSWORD=${WORKSPACE_AUTH_PASSWORD:-${OPENCODE_SERVER_PASSWORD:-""}}

OUTPUT_PATH=${OUTPUT_PATH:-"${ROOT_DIR}/dist/nginx.conf"}
TARGET_PATH=${TARGET_PATH:-"/etc/nginx/sites-available/default"}
"${SCRIPT_DIR}/generate-nginx.sh" "${OUTPUT_PATH}"

if [ "${WORKSPACE_AUTH_PROVIDER:-nginx}" = "nginx" ] && [ -n "${WORKSPACE_AUTH_USERNAME:-}" ] && [ -n "${WORKSPACE_AUTH_PASSWORD:-}" ]; then
  HASH=$(openssl passwd -apr1 "${WORKSPACE_AUTH_PASSWORD}")
  sudo mkdir -p "$(dirname "${OPENCODE_HTPASSWD_FILE}")"
  printf '%s:%s\n' "${WORKSPACE_AUTH_USERNAME}" "${HASH}" | sudo tee "${OPENCODE_HTPASSWD_FILE}" >/dev/null
  sudo chmod 640 "${OPENCODE_HTPASSWD_FILE}"
  sudo chown root:www-data "${OPENCODE_HTPASSWD_FILE}"
fi

# Copy DevBubble widget to static serving directory
WIDGET_SRC="${ROOT_DIR}/dist/dev-bubble.js"
WIDGET_DEST="${WIDGET_DIR:-/var/www/static}/dev-bubble.js"
if [ -f "$WIDGET_SRC" ]; then
  sudo mkdir -p "$(dirname "$WIDGET_DEST")"
  sudo cp "$WIDGET_SRC" "$WIDGET_DEST"
  sudo chown www-data:www-data "$WIDGET_DEST"
fi

sudo cp "${OUTPUT_PATH}" "${TARGET_PATH}"
sudo nginx -t
sudo systemctl enable nginx >/dev/null 2>&1 || true

if sudo systemctl is-active --quiet nginx; then
  sudo systemctl reload nginx
else
  sudo systemctl start nginx
fi

echo "Deployed nginx config to ${TARGET_PATH}"
