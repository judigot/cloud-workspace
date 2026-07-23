#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
ENV_FILE="${ROOT_DIR}/.env"

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

# init.sh currently owns the base EC2 bootstrap. Run it with temporary Basic Auth,
# then switch the completed workspace to GitHub OAuth and redeploy Nginx.
TEMP_AUTH_USER="bootstrap"
TEMP_AUTH_PASSWORD=$(openssl rand -hex 24)

write_env_value DOMAIN "$DOMAIN"
write_env_value OPENCODE_SUBDOMAIN "$OPENCODE_SUBDOMAIN"
write_env_value WORKSPACE_AUTH_PROVIDER "nginx"
write_env_value WORKSPACE_AUTH_USERNAME "$TEMP_AUTH_USER"
write_env_value WORKSPACE_AUTH_PASSWORD "$TEMP_AUTH_PASSWORD"
chmod 600 "$ENV_FILE"

printf '\nBootstrapping the workspace before enabling GitHub authentication...\n'
printf '\n\n\n\n' | bash "${SCRIPT_DIR}/init.sh"

write_env_value WORKSPACE_AUTH_PROVIDER "github"
write_env_value WORKSPACE_AUTH_USERNAME ""
write_env_value WORKSPACE_AUTH_PASSWORD ""
write_env_value GITHUB_OAUTH_CLIENT_ID "$GITHUB_OAUTH_CLIENT_ID"
write_env_value GITHUB_OAUTH_CLIENT_SECRET "$GITHUB_OAUTH_CLIENT_SECRET"
write_env_value GITHUB_ALLOWED_USERS "$GITHUB_ALLOWED_USERS"
write_env_value OAUTH2_PROXY_COOKIE_SECRET "$OAUTH2_PROXY_COOKIE_SECRET"
write_env_value OAUTH2_PROXY_PORT "$OAUTH2_PROXY_PORT"
chmod 600 "$ENV_FILE"

bash "${SCRIPT_DIR}/deploy-nginx.sh"

printf '\nGitHub authentication is enabled.\n'
printf 'Open https://%s and sign in with an allowed GitHub account.\n' "$OPENCODE_SUBDOMAIN"
