#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
ENV_FILE=${ENV_FILE:-"${ROOT_DIR}/.env"}
SERVICE_ENV_FILE=${OAUTH2_PROXY_ENV_FILE:-"/etc/judigot/oauth2-proxy.env"}
SERVICE_FILE=${OAUTH2_PROXY_SERVICE_FILE:-"/etc/systemd/system/oauth2-proxy.service"}
BINARY_PATH=${OAUTH2_PROXY_BINARY:-"/usr/local/bin/oauth2-proxy"}
OAUTH2_PROXY_PORT=${OAUTH2_PROXY_PORT:-4180}

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

if [ "${WORKSPACE_AUTH_PROVIDER:-nginx}" != "github" ]; then
  exit 0
fi

required=(GITHUB_OAUTH_CLIENT_ID GITHUB_OAUTH_CLIENT_SECRET GITHUB_ALLOWED_USERS OAUTH2_PROXY_COOKIE_SECRET OPENCODE_SUBDOMAIN)
for variable in "${required[@]}"; do
  if [ -z "${!variable:-}" ]; then
    echo "Missing required GitHub authentication setting: ${variable}" >&2
    exit 1
  fi
done

ARCH=$(uname -m)
case "$ARCH" in
  x86_64) OAUTH_ARCH=amd64 ;;
  aarch64|arm64) OAUTH_ARCH=arm64 ;;
  *) echo "Unsupported architecture: ${ARCH}" >&2; exit 1 ;;
esac

if [ ! -x "$BINARY_PATH" ]; then
  VERSION=${OAUTH2_PROXY_VERSION:-}
  if [ -z "$VERSION" ]; then
    VERSION=$(curl -fsSL https://api.github.com/repos/oauth2-proxy/oauth2-proxy/releases/latest \
      | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' \
      | head -1)
  fi

  if [ -z "$VERSION" ]; then
    echo "Could not resolve oauth2-proxy version" >&2
    exit 1
  fi

  TMP_DIR=$(mktemp -d)
  trap 'rm -rf "$TMP_DIR"' EXIT
  ARCHIVE="oauth2-proxy-v${VERSION}.linux-${OAUTH_ARCH}.tar.gz"
  URL="https://github.com/oauth2-proxy/oauth2-proxy/releases/download/v${VERSION}/${ARCHIVE}"

  curl -fsSL "$URL" -o "${TMP_DIR}/${ARCHIVE}"
  tar -xzf "${TMP_DIR}/${ARCHIVE}" -C "$TMP_DIR"
  sudo install -m 0755 "${TMP_DIR}/oauth2-proxy-v${VERSION}.linux-${OAUTH_ARCH}/oauth2-proxy" "$BINARY_PATH"
fi

if ! id oauth2-proxy >/dev/null 2>&1; then
  sudo useradd --system --home-dir /var/lib/oauth2-proxy --create-home --shell /usr/sbin/nologin oauth2-proxy
fi

sudo mkdir -p "$(dirname "$SERVICE_ENV_FILE")"
COOKIE_DOMAIN=".${OPENCODE_SUBDOMAIN#*.}"

sudo tee "$SERVICE_ENV_FILE" >/dev/null <<EOF
OAUTH2_PROXY_PROVIDER=github
OAUTH2_PROXY_HTTP_ADDRESS=127.0.0.1:${OAUTH2_PROXY_PORT}
OAUTH2_PROXY_REVERSE_PROXY=true
OAUTH2_PROXY_CLIENT_ID=${GITHUB_OAUTH_CLIENT_ID}
OAUTH2_PROXY_CLIENT_SECRET=${GITHUB_OAUTH_CLIENT_SECRET}
OAUTH2_PROXY_COOKIE_SECRET=${OAUTH2_PROXY_COOKIE_SECRET}
OAUTH2_PROXY_REDIRECT_URL=https://${OPENCODE_SUBDOMAIN}/oauth2/callback
OAUTH2_PROXY_GITHUB_USER=${GITHUB_ALLOWED_USERS}
OAUTH2_PROXY_EMAIL_DOMAINS=*
OAUTH2_PROXY_COOKIE_SECURE=true
OAUTH2_PROXY_COOKIE_HTTPONLY=true
OAUTH2_PROXY_COOKIE_SAMESITE=lax
OAUTH2_PROXY_COOKIE_DOMAINS=${COOKIE_DOMAIN}
OAUTH2_PROXY_UPSTREAMS=static://202
OAUTH2_PROXY_SET_XAUTHREQUEST=true
OAUTH2_PROXY_SKIP_PROVIDER_BUTTON=true
EOF
sudo chmod 600 "$SERVICE_ENV_FILE"
sudo chown root:root "$SERVICE_ENV_FILE"

sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=GitHub OAuth gateway for the development workspace
After=network-online.target
Wants=network-online.target

[Service]
User=oauth2-proxy
Group=oauth2-proxy
EnvironmentFile=${SERVICE_ENV_FILE}
ExecStart=${BINARY_PATH}
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryDenyWriteExecute=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now oauth2-proxy
sudo systemctl restart oauth2-proxy

echo "GitHub OAuth gateway is running on 127.0.0.1:${OAUTH2_PROXY_PORT}"
