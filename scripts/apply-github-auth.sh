#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH=${1:?Usage: apply-github-auth.sh <nginx-config>}
WORKSPACE_AUTH_PROVIDER=${WORKSPACE_AUTH_PROVIDER:-nginx}

if [ "$WORKSPACE_AUTH_PROVIDER" != "github" ]; then
  exit 0
fi

OAUTH2_PROXY_BACKEND=${OAUTH2_PROXY_BACKEND:-127.0.0.1:4180}
OPENCODE_SUBDOMAIN=${OPENCODE_SUBDOMAIN:-dev.${DOMAIN:-judigot.com}}

python3 - "$CONFIG_PATH" "$OAUTH2_PROXY_BACKEND" "$OPENCODE_SUBDOMAIN" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
backend = sys.argv[2]
dev_domain = sys.argv[3]
text = path.read_text()

upstream_anchor = "upstream opencode_backend {"
if upstream_anchor not in text:
    raise SystemExit("Could not find OpenCode upstream in generated nginx config")

upstream = f"""upstream oauth2_proxy_backend {{
    server {backend};
    keepalive 8;
}}

"""
text = text.replace(upstream_anchor, upstream + upstream_anchor, 1)

server_anchor = f"    server_name {dev_domain};\n"
if server_anchor not in text:
    raise SystemExit(f"Could not find development server block for {dev_domain}")

auth_block = """

    # GitHub OAuth authentication gateway. All locations in this server inherit
    # this check unless they explicitly disable it below.
    auth_request /oauth2/auth;
    error_page 401 = /oauth2/sign_in;

    location /oauth2/ {
        auth_request off;
        proxy_pass http://oauth2_proxy_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Auth-Request-Redirect $scheme://$host$request_uri;
    }

    location = /oauth2/auth {
        auth_request off;
        proxy_pass http://oauth2_proxy_backend/oauth2/auth;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Uri $request_uri;
    }
"""

text = text.replace(server_anchor, server_anchor + auth_block, 1)
path.write_text(text)
PY

echo "Applied GitHub OAuth protection to ${CONFIG_PATH}"
