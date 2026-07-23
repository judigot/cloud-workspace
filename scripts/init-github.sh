#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
ENV_FILE="${ROOT_DIR}/.env"
RUNTIME_INIT="${SCRIPT_DIR}/.init-github-runtime.sh"

prompt_value() {
  local variable="$1"
  local label="$2"
  local default_value="${3:-}"
  local secret="${4:-false}"
  local current_value=""
  local input=""

  eval "current_value=\${${variable}:-}"
  [ -n "$current_value" ] && default_value="$current_value"

  if [ "$secret" = "true" ]; then
    if [ -n "$default_value" ]; then
      printf '  %s [configured]: ' "$label"
    else
      printf '  %s: ' "$label"
    fi
    read -rs input
    printf '\n'
  else
    if [ -n "$default_value" ]; then
      printf '  %s [%s]: ' "$label" "$default_value"
    else
      printf '  %s: ' "$label"
    fi
    read -r input
  fi

  input="${input:-$default_value}"
  if [ -z "$input" ]; then
    printf 'Missing required value: %s\n' "$variable" >&2
    exit 1
  fi

  printf -v "$variable" '%s' "$input"
}

write_env_value() {
  local key="$1"
  local value="$2"
  local temporary_file
  temporary_file=$(mktemp)

  if [ -f "$ENV_FILE" ]; then
    grep -Ev "^${key}=" "$ENV_FILE" > "$temporary_file" || true
  fi
  printf '%s=%s\n' "$key" "$value" >> "$temporary_file"
  mv "$temporary_file" "$ENV_FILE"
}

cleanup() {
  rm -f "$RUNTIME_INIT"
}
trap cleanup EXIT

if [ ! -t 0 ]; then
  printf 'GitHub bootstrap requires an interactive terminal. Run it directly from SSH.\n' >&2
  exit 1
fi

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

DOMAIN=${DOMAIN:-judigot.com}
OPENCODE_SUBDOMAIN=${OPENCODE_SUBDOMAIN:-dev.${DOMAIN}}
GITHUB_ALLOWED_USERS=${GITHUB_ALLOWED_USERS:-judigot}
OAUTH2_PROXY_PORT=${OAUTH2_PROXY_PORT:-4180}

printf '\nGitHub OAuth application settings\n'
printf '  Homepage URL: https://%s\n' "$OPENCODE_SUBDOMAIN"
printf '  Callback URL: https://%s/oauth2/callback\n\n' "$OPENCODE_SUBDOMAIN"
printf 'Create the OAuth App first, then enter its credentials below.\n\n'

prompt_value GITHUB_OAUTH_CLIENT_ID "GitHub OAuth client ID" "${GITHUB_OAUTH_CLIENT_ID:-}"
prompt_value GITHUB_OAUTH_CLIENT_SECRET "GitHub OAuth client secret" "${GITHUB_OAUTH_CLIENT_SECRET:-}" true
prompt_value GITHUB_ALLOWED_USERS "Allowed GitHub usernames (comma-separated)" "$GITHUB_ALLOWED_USERS"

if [ -z "${OAUTH2_PROXY_COOKIE_SECRET:-}" ]; then
  OAUTH2_PROXY_COOKIE_SECRET=$(openssl rand -base64 32 | tr '+/' '-_')
fi

write_env_value DOMAIN "$DOMAIN"
write_env_value OPENCODE_SUBDOMAIN "$OPENCODE_SUBDOMAIN"
write_env_value WORKSPACE_AUTH_PROVIDER "github"
write_env_value WORKSPACE_AUTH_USERNAME ""
write_env_value WORKSPACE_AUTH_PASSWORD ""
write_env_value GITHUB_OAUTH_CLIENT_ID "$GITHUB_OAUTH_CLIENT_ID"
write_env_value GITHUB_OAUTH_CLIENT_SECRET "$GITHUB_OAUTH_CLIENT_SECRET"
write_env_value GITHUB_ALLOWED_USERS "$GITHUB_ALLOWED_USERS"
write_env_value OAUTH2_PROXY_COOKIE_SECRET "$OAUTH2_PROXY_COOKIE_SECRET"
write_env_value OAUTH2_PROXY_PORT "$OAUTH2_PROXY_PORT"
chmod 600 "$ENV_FILE"

# Use the existing stable init workflow and DNS retry loop, but extend its
# configuration section for GitHub authentication. The generated runtime copy
# lives beside init.sh so all relative script paths remain unchanged.
python3 - "${SCRIPT_DIR}/init.sh" "$RUNTIME_INIT" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text()
output = Path(sys.argv[2])

old_prompt = '''prompt         DOMAIN                   "Domain"                      "${DOMAIN:-judigot.com}"
prompt_choice  WORKSPACE_AUTH_PROVIDER  "Authentication provider"    "${WORKSPACE_AUTH_PROVIDER:-nginx}" nginx opencode
if [ "${WORKSPACE_AUTH_PROVIDER}" = "nginx" ]; then
  prompt         WORKSPACE_AUTH_USERNAME "Dev subdomain username"     "${WORKSPACE_AUTH_USERNAME:-}"
  prompt_secret  WORKSPACE_AUTH_PASSWORD "Dev subdomain password"     "${WORKSPACE_AUTH_PASSWORD:-}"
else
  prompt         WORKSPACE_AUTH_USERNAME "OpenCode username"          "${WORKSPACE_AUTH_USERNAME:-}"
  prompt_secret  WORKSPACE_AUTH_PASSWORD "OpenCode password"          "${WORKSPACE_AUTH_PASSWORD:-}"
fi
'''

new_prompt = '''prompt         DOMAIN                   "Domain"                      "${DOMAIN:-judigot.com}"
prompt_choice  WORKSPACE_AUTH_PROVIDER  "Authentication provider"    "${WORKSPACE_AUTH_PROVIDER:-github}" github nginx opencode
case "${WORKSPACE_AUTH_PROVIDER}" in
  github)
    WORKSPACE_AUTH_USERNAME=""
    WORKSPACE_AUTH_PASSWORD=""
    ;;
  nginx)
    prompt         WORKSPACE_AUTH_USERNAME "Dev subdomain username"     "${WORKSPACE_AUTH_USERNAME:-}"
    prompt_secret  WORKSPACE_AUTH_PASSWORD "Dev subdomain password"     "${WORKSPACE_AUTH_PASSWORD:-}"
    ;;
  opencode)
    prompt         WORKSPACE_AUTH_USERNAME "OpenCode username"          "${WORKSPACE_AUTH_USERNAME:-}"
    prompt_secret  WORKSPACE_AUTH_PASSWORD "OpenCode password"          "${WORKSPACE_AUTH_PASSWORD:-}"
    ;;
esac
'''

if old_prompt not in source:
    raise SystemExit("Could not locate init.sh authentication prompt block")
source = source.replace(old_prompt, new_prompt, 1)

old_env = '''WORKSPACE_AUTH_PROVIDER=${WORKSPACE_AUTH_PROVIDER}
WORKSPACE_AUTH_USERNAME=${WORKSPACE_AUTH_USERNAME}
WORKSPACE_AUTH_PASSWORD=${WORKSPACE_AUTH_PASSWORD}
API_BACKEND=${API_BACKEND}
'''
new_env = '''WORKSPACE_AUTH_PROVIDER=${WORKSPACE_AUTH_PROVIDER}
WORKSPACE_AUTH_USERNAME=${WORKSPACE_AUTH_USERNAME}
WORKSPACE_AUTH_PASSWORD=${WORKSPACE_AUTH_PASSWORD}
GITHUB_OAUTH_CLIENT_ID=${GITHUB_OAUTH_CLIENT_ID:-}
GITHUB_OAUTH_CLIENT_SECRET=${GITHUB_OAUTH_CLIENT_SECRET:-}
GITHUB_ALLOWED_USERS=${GITHUB_ALLOWED_USERS:-}
OAUTH2_PROXY_COOKIE_SECRET=${OAUTH2_PROXY_COOKIE_SECRET:-}
OAUTH2_PROXY_PORT=${OAUTH2_PROXY_PORT:-4180}
API_BACKEND=${API_BACKEND}
'''

if old_env not in source:
    raise SystemExit("Could not locate init.sh environment output block")
source = source.replace(old_env, new_env, 1)

output.write_text(source)
output.chmod(0o700)
PY

export WORKSPACE_AUTH_PROVIDER="github"
export GITHUB_OAUTH_CLIENT_ID GITHUB_OAUTH_CLIENT_SECRET GITHUB_ALLOWED_USERS
export OAUTH2_PROXY_COOKIE_SECRET OAUTH2_PROXY_PORT

printf '\nBootstrapping the workspace with GitHub authentication...\n'
printf 'If DNS is not ready, update it and press Enter to retry without leaving SSH.\n\n'
bash "$RUNTIME_INIT"

printf '\nGitHub authentication is enabled.\n'
printf 'Open https://%s and sign in with an allowed GitHub account.\n' "$OPENCODE_SUBDOMAIN"
