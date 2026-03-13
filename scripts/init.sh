#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
ENV_FILE="${ROOT_DIR}/.env"

# ─── Helpers ──────────────────────────────────────────────────────────────────

red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
cyan()   { printf '\033[0;36m%s\033[0m\n' "$*"; }
bold()   { printf '\033[1m%s\033[0m\n' "$*"; }

step() { printf '\n\033[1;36m[%s/%s]\033[0m \033[1m%s\033[0m\n' "$1" "$TOTAL_STEPS" "$2"; }
ok()   { green "  ✓ $*"; }
warn() { yellow "  ⚠ $*"; }
fail() { red "  ✗ $*"; }

prompt() {
  local var_name="$1" prompt_text="$2" default="$3" required="${4:-true}"
  local current=""

  # Use existing value from environment (loaded from .env) as default
  eval "current=\${${var_name}:-}"
  [ -n "$current" ] && default="$current"

  if [ -n "$default" ]; then
    printf '  %s [%s]: ' "$prompt_text" "$default"
  else
    if [ "$required" = "false" ]; then
      printf '  %s (optional): ' "$prompt_text"
    else
      printf '  %s: ' "$prompt_text"
    fi
  fi

  local input
  read -r input
  input="${input:-$default}"

  if [ -z "$input" ] && [ "$required" = "true" ]; then
    fail "$var_name is required"
    exit 1
  fi

  eval "$var_name=\"\$input\""
}

prompt_secret() {
  local var_name="$1" prompt_text="$2" default="$3" required="${4:-true}"
  local current=""

  eval "current=\${${var_name}:-}"
  [ -n "$current" ] && default="$current"

  if [ -n "$default" ]; then
    local masked
    masked=$(printf '%s' "$default" | sed 's/./*/g')
    printf '  %s [%s]: ' "$prompt_text" "$masked"
  else
    if [ "$required" = "false" ]; then
      printf '  %s (optional, press Enter to skip): ' "$prompt_text"
    else
      printf '  %s: ' "$prompt_text"
    fi
  fi

  local input
  read -rs input
  printf '\n'
  input="${input:-$default}"

  if [ -z "$input" ] && [ "$required" = "true" ]; then
    fail "$var_name is required"
    exit 1
  fi

  eval "$var_name=\"\$input\""
}

prompt_choice() {
  local var_name="$1" prompt_text="$2" default="$3"
  shift 3
  local choices=("$@")
  local current=""

  eval "current=\${${var_name}:-}"
  [ -n "$current" ] && default="$current"

  if [ ${#choices[@]} -eq 0 ]; then
    fail "prompt_choice requires at least one option"
    exit 1
  fi

  while true; do
    printf '  %s' "$prompt_text"
    if [ -n "$default" ]; then
      printf ' [%s]' "$default"
    fi
    printf ' (%s): ' "$(IFS='/'; printf '%s' "${choices[*]}")"

    local input
    read -r input
    input="${input:-$default}"

    for choice in "${choices[@]}"; do
      if [ "$input" = "$choice" ]; then
        eval "$var_name=\"\$input\""
        return 0
      fi
    done

    warn "Invalid choice: ${input}. Choose one of: ${choices[*]}"
  done
}

TOTAL_STEPS=6

install_missing_system_prereqs() {
  local missing=()

  if ! command -v nginx >/dev/null 2>&1; then
    missing+=("nginx")
  fi

  if ! command -v certbot >/dev/null 2>&1; then
    missing+=("certbot" "python3-certbot-nginx")
  fi

  # Native Node modules (e.g. node-pty) require a compiler toolchain.
  if ! command -v g++ >/dev/null 2>&1; then
    missing+=("build-essential")
  fi

  if [ ${#missing[@]} -eq 0 ]; then
    return 0
  fi

  if ! command -v apt-get >/dev/null 2>&1; then
    fail "Missing system prerequisites: ${missing[*]}"
    fail "apt-get is not available, so auto-install cannot run"
    return 1
  fi

  local installer=""
  if [ "$(id -u)" -eq 0 ]; then
    installer=""
  elif command -v sudo >/dev/null 2>&1; then
    installer="sudo"
  else
    fail "Missing system prerequisites: ${missing[*]}"
    fail "sudo is required to auto-install system packages"
    return 1
  fi

  warn "Missing system packages detected: ${missing[*]}"
  warn "Installing via apt-get (idempotent)..."

  if [ -n "$installer" ]; then
    $installer apt-get update -y
    $installer apt-get install -y "${missing[@]}"
  else
    apt-get update -y
    apt-get install -y "${missing[@]}"
  fi

  ok "Installed missing system prerequisites"
}

get_instance_public_ipv4() {
  local token=""
  local ip=""

  token=$(curl -fsS --max-time 2 -X PUT \
    "http://169.254.169.254/latest/api/token" \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || true)

  if [ -n "$token" ]; then
    ip=$(curl -fsS --max-time 2 \
      -H "X-aws-ec2-metadata-token: ${token}" \
      "http://169.254.169.254/latest/meta-data/public-ipv4" 2>/dev/null || true)
  else
    ip=$(curl -fsS --max-time 2 \
      "http://169.254.169.254/latest/meta-data/public-ipv4" 2>/dev/null || true)
  fi

  if [ -z "$ip" ]; then
    ip=$(curl -fsS --max-time 3 "https://api.ipify.org" 2>/dev/null || true)
  fi

  if [ -z "$ip" ]; then
    ip=$(curl -fsS --max-time 3 "https://ifconfig.me/ip" 2>/dev/null || true)
  fi

  printf '%s' "$ip"
}

get_domain_ipv4s() {
  local domain="$1"
  local ips=()
  local ip=""

  while IFS=' ' read -r ip _; do
    [ -n "$ip" ] || continue
    case " ${ips[*]} " in
      *" ${ip} "*) ;;
      *) ips+=("$ip") ;;
    esac
  done < <(getent ahostsv4 "$domain" 2>/dev/null || true)

  printf '%s' "${ips[*]}"
}

domain_points_to_ip() {
  local domain="$1"
  local expected_ip="$2"
  local ip=""
  local ips

  ips=$(get_domain_ipv4s "$domain")
  [ -n "$ips" ] || return 1

  for ip in $ips; do
    if [ "$ip" = "$expected_ip" ]; then
      return 0
    fi
  done

  return 1
}

ensure_dns_ready_for_certbot() {
  local expected_ip=""
  local domains=("$DOMAIN" "$WWW_DOMAIN" "$OPENCODE_SUBDOMAIN")
  local mismatch_domains=()
  local mismatch_ips=()
  local pending=0
  local domain=""
  local ips=""
  local observed=""
  local i=0

  expected_ip=$(get_instance_public_ipv4)
  if [ -z "$expected_ip" ]; then
    warn "Could not auto-detect this instance public IPv4; skipping DNS pre-check"
    return 0
  fi

  ok "Instance public IPv4 detected: ${expected_ip}"

  while true; do
    pending=0
    mismatch_domains=()
    mismatch_ips=()

    for domain in "${domains[@]}"; do
      ips=$(get_domain_ipv4s "$domain")

      if ! domain_points_to_ip "$domain" "$expected_ip"; then
        pending=1
        observed=${ips:-"(no A record found)"}
        mismatch_domains+=("$domain")
        mismatch_ips+=("$observed")
      fi
    done

    if [ "$pending" -eq 0 ]; then
      ok "All certificate domains point to this instance"
      return 0
    fi

    printf '\n'
    yellow "  DNS mismatch (update required):"
    for i in "${!mismatch_domains[@]}"; do
      printf '    • %-22s resolves to %s  -> expected %s\n' \
        "${mismatch_domains[$i]}" "${mismatch_ips[$i]}" "$expected_ip"
    done

    printf '\n'
    printf '  Next steps:\n'
    printf '    1) Update the A/AAAA records (or CNAME where applicable) to point to %s\n' "$expected_ip"
    printf '    2) Wait a few minutes for DNS propagation\n'

    if [ ! -t 0 ]; then
      fail "DNS is not pointed to this instance yet"
      fail "Set A records for ${DOMAIN}, ${WWW_DOMAIN}, ${OPENCODE_SUBDOMAIN} to ${expected_ip}"
      return 1
    fi

    printf '\n'
    printf '  Press Enter to retry DNS check, or Ctrl+C to cancel: '
    read -r _
  done
}

# ─── Load existing .env if present ────────────────────────────────────────────

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

# ─── Step 1: Preflight ───────────────────────────────────────────────────────

step 1 "Preflight checks"

MISSING=()

if ! install_missing_system_prereqs; then
  exit 1
fi

for cmd in nginx certbot node npm bun g++; do
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$cmd $(${cmd} --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+[.0-9]*' | head -1)"
  else
    fail "$cmd not found"
    MISSING+=("$cmd")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  red ""
  red "  Missing prerequisites: ${MISSING[*]}"
  red "  Run the bootstrap chain first:"
  red ""
  red "    . <(curl -fsSL \"https://raw.githubusercontent.com/judigot/user/main/load-devrc.sh?cb=\$(date +%s)\")"
  red "    initubuntu && installnodeenv"
  red ""
  exit 1
fi

# Check opencode — install via .devrc alias if missing
if command -v opencode >/dev/null 2>&1; then
  ok "opencode $(opencode --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+[.0-9]*' | head -1)"
else
  warn "opencode not found — installing..."
  if [ -f "$HOME/.devrc" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.devrc"
    installOpenCode
    ok "opencode installed"
  else
    npm i -g opencode-ai
    ok "opencode installed via npm"
  fi
fi

# ─── Step 2: Configuration ────────────────────────────────────────────────────

step 2 "Configuration"

if [ -z "${WORKSPACE_AUTH_PROVIDER:-}" ]; then
  if [ -n "${WORKSPACE_AUTH_USERNAME:-}" ] || [ -n "${WORKSPACE_AUTH_PASSWORD:-}" ]; then
    WORKSPACE_AUTH_PROVIDER="${WORKSPACE_AUTH_PROVIDER:-nginx}"
  elif [ -n "${OPENCODE_SERVER_USERNAME:-}" ] || [ -n "${OPENCODE_SERVER_PASSWORD:-}" ]; then
    WORKSPACE_AUTH_PROVIDER="nginx"
    WORKSPACE_AUTH_USERNAME="${WORKSPACE_AUTH_USERNAME:-${OPENCODE_SERVER_USERNAME:-}}"
    WORKSPACE_AUTH_PASSWORD="${WORKSPACE_AUTH_PASSWORD:-${OPENCODE_SERVER_PASSWORD:-}}"
  else
    WORKSPACE_AUTH_PROVIDER="nginx"
  fi
fi

prompt         DOMAIN                   "Domain"                      "${DOMAIN:-judigot.com}"
prompt_choice  WORKSPACE_AUTH_PROVIDER  "Authentication provider"    "${WORKSPACE_AUTH_PROVIDER:-nginx}" nginx opencode
if [ "${WORKSPACE_AUTH_PROVIDER}" = "nginx" ]; then
  prompt         WORKSPACE_AUTH_USERNAME "Dev subdomain username"     "${WORKSPACE_AUTH_USERNAME:-}"
  prompt_secret  WORKSPACE_AUTH_PASSWORD "Dev subdomain password"     "${WORKSPACE_AUTH_PASSWORD:-}"
else
  prompt         WORKSPACE_AUTH_USERNAME "OpenCode username"          "${WORKSPACE_AUTH_USERNAME:-}"
  prompt_secret  WORKSPACE_AUTH_PASSWORD "OpenCode password"          "${WORKSPACE_AUTH_PASSWORD:-}"
fi
prompt_secret  ANTHROPIC_API_KEY       "Anthropic API key"            "${ANTHROPIC_API_KEY:-}" "false"

# Derived values
WWW_DOMAIN=${WWW_DOMAIN:-"www.${DOMAIN}"}
OPENCODE_SUBDOMAIN=${OPENCODE_SUBDOMAIN:-"dev.${DOMAIN}"}
OPENCODE_PORT=${OPENCODE_PORT:-4097}
OPENCODE_BACKEND=${OPENCODE_BACKEND:-"127.0.0.1:${OPENCODE_PORT}"}
API_BACKEND=${API_BACKEND:-"127.0.0.1:5000"}
VITE_SCAFFOLDER_PORT=${VITE_SCAFFOLDER_PORT:-3000}
VITE_APPS=${VITE_APPS:-""}
WORKSPACE_ROOT=${WORKSPACE_ROOT:-"/var/www/workspace"}
CERTBOT_EMAIL=${CERTBOT_EMAIL:-""}

# Use a non-interactive certbot contact by default to avoid setup prompts.
# Override by setting CERTBOT_EMAIL in .env before running init.sh.
if [ -z "${CERTBOT_EMAIL}" ]; then
  CERTBOT_EMAIL="admin@${DOMAIN}"
fi

# Write .env
cat > "$ENV_FILE" <<EOF
DOMAIN=${DOMAIN}
WWW_DOMAIN=${WWW_DOMAIN}
OPENCODE_SUBDOMAIN=${OPENCODE_SUBDOMAIN}
OPENCODE_PORT=${OPENCODE_PORT}
OPENCODE_BACKEND=${OPENCODE_BACKEND}
WORKSPACE_AUTH_PROVIDER=${WORKSPACE_AUTH_PROVIDER}
WORKSPACE_AUTH_USERNAME=${WORKSPACE_AUTH_USERNAME}
WORKSPACE_AUTH_PASSWORD=${WORKSPACE_AUTH_PASSWORD}
API_BACKEND=${API_BACKEND}
VITE_SCAFFOLDER_PORT=${VITE_SCAFFOLDER_PORT}
VITE_APPS="${VITE_APPS}"
WORKSPACE_ROOT=${WORKSPACE_ROOT}
EOF

if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}" >> "$ENV_FILE"
fi

ok "Wrote ${ENV_FILE}"

# ─── Step 3: TLS certificates ────────────────────────────────────────────────

step 3 "TLS certificates"

SSL_CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
SSL_KEY="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"

ALL_DOMAINS="${DOMAIN},${WWW_DOMAIN},${OPENCODE_SUBDOMAIN}"

# Idempotent TLS: if cert files already exist, skip certbot entirely.
# This avoids all interactive prompts and rate-limit issues on reruns.
# Use sudo for the check — letsencrypt/live/ is root-only.
if sudo test -f "$SSL_CERT" && sudo test -f "$SSL_KEY"; then
  ok "Certs already exist — skipping certbot"
else
  ensure_dns_ready_for_certbot
  warn "No certs found — issuing via certbot..."
  sudo systemctl stop nginx 2>/dev/null || true
  sudo certbot certonly --standalone \
    --cert-name "$DOMAIN" \
    -d "$ALL_DOMAINS" \
    --non-interactive --agree-tos --no-eff-email -m "$CERTBOT_EMAIL"
  ok "Certs ready"
fi

# ─── Step 4: Nginx ───────────────────────────────────────────────────────────

step 4 "Nginx"

DASHBOARD_PORT=${DASHBOARD_PORT:-3200}
DASHBOARD_API_PORT=${DASHBOARD_API_PORT:-3100}

export DOMAIN WWW_DOMAIN OPENCODE_SUBDOMAIN
export SSL_CERT SSL_KEY
export VITE_SCAFFOLDER_PORT API_BACKEND OPENCODE_BACKEND
export WORKSPACE_ROOT VITE_APPS DASHBOARD_PORT DASHBOARD_API_PORT

"${SCRIPT_DIR}/deploy-nginx.sh"
ok "Nginx config deployed and reloaded"

# ─── Step 5: OpenCode service ─────────────────────────────────────────────────

step 5 "OpenCode service"

NODE_BIN=$(dirname "$(command -v node)")
BUN_PATH=$(command -v bun)
BUN_BIN=$(dirname "${BUN_PATH}")

SERVICE_FILE="/etc/systemd/system/opencode.service"

# Build environment lines
OPENCODE_ENV_LINES="Environment=\"PATH=${NODE_BIN}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\"
Environment=\"LANG=en_US.UTF-8\"
Environment=\"LC_ALL=en_US.UTF-8\""

if [ "${WORKSPACE_AUTH_PROVIDER}" = "opencode" ]; then
  OPENCODE_ENV_LINES="${OPENCODE_ENV_LINES}
Environment=\"OPENCODE_SERVER_USERNAME=${WORKSPACE_AUTH_USERNAME}\"
Environment=\"OPENCODE_SERVER_PASSWORD=${WORKSPACE_AUTH_PASSWORD}\""
fi

if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  OPENCODE_ENV_LINES="${OPENCODE_ENV_LINES}
Environment=\"ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}\""
fi

sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=OpenCode Web UI
After=network.target

[Service]
Type=simple
User=$(whoami)
${OPENCODE_ENV_LINES}
ExecStart=${NODE_BIN}/opencode web --port ${OPENCODE_PORT} --hostname 127.0.0.1
Restart=always
RestartSec=5
WorkingDirectory=${ROOT_DIR}

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable opencode >/dev/null 2>&1

# Kill any opencode process holding the port (e.g. manual runs outside systemd)
if PID=$(sudo lsof -ti :"${OPENCODE_PORT}" 2>/dev/null); then
  warn "Killing existing process on port ${OPENCODE_PORT} (PID: ${PID})"
  sudo kill -9 $PID 2>/dev/null || true
  sleep 1
fi

sudo systemctl restart opencode

# Wait for opencode to be ready
printf '  Waiting for OpenCode on port %s' "$OPENCODE_PORT"
for i in $(seq 1 30); do
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${OPENCODE_PORT}" 2>/dev/null || true)
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "401" ]; then
    printf '\n'
    ok "OpenCode is running on port ${OPENCODE_PORT}"
    break
  fi
  printf '.'
  sleep 1
  if [ "$i" -eq 30 ]; then
    printf '\n'
    fail "OpenCode did not start within 30s — check: sudo journalctl -u opencode -n 20"
    exit 1
  fi
done

# ─── Step 6: Dashboard app ────────────────────────────────────────────────────

step 6 "Dashboard app"

DASHBOARD_DIR="${ROOT_DIR}/dashboard"

ok "Dashboard lives at ${DASHBOARD_DIR} (part of workspace repo)"

# Install deps
if [ ! -d "${DASHBOARD_DIR}/node_modules" ]; then
  warn "Installing dashboard dependencies..."
  (cd "${DASHBOARD_DIR}" && bun install)
  ok "Dependencies installed"
else
  ok "Dependencies already installed"
fi

# Build DevBubble widget bundle
WIDGET_OUT="${ROOT_DIR}/dist/dev-bubble.js"
warn "Building DevBubble widget..."
mkdir -p "${ROOT_DIR}/dist"
(cd "${DASHBOARD_DIR}" && bunx esbuild packages/dev-bubble/src/widget.tsx \
  --bundle --minify --format=iife --target=es2020 --jsx=automatic \
  --outfile="${WIDGET_OUT}")
ok "DevBubble widget built ($(du -h "${WIDGET_OUT}" | cut -f1))"

# Re-deploy nginx so the widget bundle is copied to /var/www/static/
"${SCRIPT_DIR}/deploy-nginx.sh"
ok "Nginx re-deployed with DevBubble widget"

# Create systemd service for dashboard API (Hono)
DASHBOARD_API_SERVICE="/etc/systemd/system/dashboard-api.service"
sudo tee "$DASHBOARD_API_SERVICE" > /dev/null <<EOF
[Unit]
Description=Dashboard API (Hono)
After=network.target

[Service]
Type=simple
User=$(whoami)
Environment="PATH=${NODE_BIN}:${BUN_BIN}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="DASHBOARD_API_PORT=${DASHBOARD_API_PORT}"
Environment="WORKSPACE_ENV_PATH=${ROOT_DIR}/.env"
ExecStart=${BUN_PATH} x tsx ${DASHBOARD_DIR}/apps/workspace/src/server/index.ts
Restart=always
RestartSec=5
WorkingDirectory=${DASHBOARD_DIR}/apps/workspace

[Install]
WantedBy=multi-user.target
EOF

# Create systemd service for dashboard Vite dev server
DASHBOARD_VITE_SERVICE="/etc/systemd/system/dashboard-vite.service"
sudo tee "$DASHBOARD_VITE_SERVICE" > /dev/null <<EOF
[Unit]
Description=Dashboard Vite Dev Server
After=network.target dashboard-api.service

[Service]
Type=simple
User=$(whoami)
Environment="PATH=${NODE_BIN}:${BUN_BIN}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="DASHBOARD_API_PORT=${DASHBOARD_API_PORT}"
ExecStart=${BUN_PATH} x vite --host 127.0.0.1 --port ${DASHBOARD_PORT}
Restart=always
RestartSec=5
WorkingDirectory=${DASHBOARD_DIR}/apps/workspace

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable dashboard-api dashboard-vite >/dev/null 2>&1
sudo systemctl restart dashboard-api dashboard-vite

printf '  Waiting for dashboard on port %s' "$DASHBOARD_PORT"
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "http://127.0.0.1:${DASHBOARD_PORT}" 2>/dev/null; then
    printf '\n'
    ok "Dashboard is running on port ${DASHBOARD_PORT}"
    break
  fi
  printf '.'
  sleep 1
  if [ "$i" -eq 30 ]; then
    printf '\n'
    fail "Dashboard did not respond within 30s — check: sudo journalctl -u dashboard-vite -n 20"
    exit 1
  fi
done

# ─── Done ─────────────────────────────────────────────────────────────────────

printf '\n'
bold "═══════════════════════════════════════════════════════"
bold "  Workspace is live"
bold "═══════════════════════════════════════════════════════"
printf '\n'
cyan "  https://${DOMAIN}                → Dashboard + apps"
cyan "  https://${OPENCODE_SUBDOMAIN}    → OpenCode (embeddable)"
printf '\n'
printf '  Auth provider: %s\n' "$WORKSPACE_AUTH_PROVIDER"
printf '  Auth user: %s / ****\n' "$WORKSPACE_AUTH_USERNAME"
printf '\n'
