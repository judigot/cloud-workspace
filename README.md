# Workspace

Mobile-first development workspace. Vibe code from your phone — open your app, tap the chat bubble, tell the AI what to change, and see it live.

## Fresh EC2 setup with GitHub authentication

GitHub authentication is handled by oauth2-proxy in front of the development subdomain. Nginx remains the public reverse proxy, while OpenCode, the workspace services, and development applications remain on localhost.

### Before running the bootstrap

Create a GitHub OAuth App with:

- Homepage URL: `https://dev.judigot.com`
- Authorization callback URL: `https://dev.judigot.com/oauth2/callback`

Keep the generated client ID and client secret ready.

The following DNS records must point to the EC2 public IP before Certbot runs:

- `judigot.com`
- `www.judigot.com`
- `dev.judigot.com`

### Test the PR branch on a fresh EC2 instance

Run:

```sh
set -euo pipefail

. <(curl -fsSL "https://raw.githubusercontent.com/judigot/user/main/load-devrc.sh?cachebustkey=$(date +%s)")

initubuntu && \
installnodeenv && \
installgithub && \
usessh && \
cd ~ && \
rm -rf ~/workspace && \
git clone --branch agent/github-oauth-authentication --single-branch git@github.com:judigot/workspace.git ~/workspace && \
cd ~/workspace && \
cp .env.example .env && \
bash ./scripts/init-github.sh
```

The GitHub bootstrap asks for:

- GitHub OAuth client ID
- GitHub OAuth client secret
- allowed GitHub usernames, defaulting to `judigot`

The session-cookie secret is generated automatically.

The bootstrap then:

1. installs the pinned OpenCode version (`opencode-ai@1.4.0`);
2. issues TLS certificates;
3. configures OpenCode and the dashboard services;
4. installs oauth2-proxy;
5. creates and starts its hardened systemd service;
6. applies GitHub authentication to the entire development subdomain;
7. validates and reloads Nginx.

### Expected authentication test

Open `https://dev.judigot.com`.

Expected behavior:

1. The browser redirects to GitHub.
2. GitHub authenticates your account.
3. oauth2-proxy checks that the GitHub username is allowed.
4. The browser returns to the originally requested page.
5. OpenCode, workspace APIs, development app previews, HMR, and WebSockets share the authenticated session.

A GitHub account not included in `GITHUB_ALLOWED_USERS` must be denied.

## Architecture

```text
Browser
  |
  v
Nginx :443
  |
  +-- /oauth2/* ----------> oauth2-proxy :4180
  |
  +-- auth_request -------> GitHub-backed session check
  |
  +-- OpenCode -----------> 127.0.0.1:4097
  +-- Workspace UI -------> 127.0.0.1:3200
  +-- Workspace API ------> 127.0.0.1:3100
  +-- Dev applications ---> localhost application ports
```

GitHub authentication protects `dev.judigot.com`, including HTTP and WebSocket traffic routed through Nginx.

Public application routes at `judigot.com/<slug>/` remain unchanged and are not protected by the development authentication gateway.

## Security boundary

The setup assumes:

- only Nginx ports are publicly reachable;
- OpenCode, oauth2-proxy, Vite, APIs, and internal tools are not exposed directly;
- the allowed-user list contains only trusted GitHub usernames;
- the GitHub account uses MFA or a passkey;
- OAuth and cookie secrets remain outside Git;
- SSH and other non-web services use separate controls.

GitHub OAuth does not authenticate SSH, Mosh, direct database connections, or any service that bypasses Nginx.

## Rerunning the setup

To rerun the GitHub-authenticated setup:

```sh
cd ~/workspace && bash ./scripts/init-github.sh
```

Existing certificates and installed binaries are reused where possible.

To regenerate and deploy Nginx after adding an application:

```sh
cd ~/workspace && bash ./scripts/deploy-nginx.sh
```

## Adding applications

Frontend application:

```sh
~/workspace/scripts/add-app.sh my-app frontend 5177
```

Full-stack application:

```sh
~/workspace/scripts/add-app.sh my-api fullstack 3000 5000 ws
```

Laravel or backend application:

```sh
~/workspace/scripts/add-app.sh admin laravel 8000
```

Development routes use `dev.judigot.com/<slug>/` and inherit the GitHub-authenticated browser session, including Vite HMR and application WebSockets.

Public routes remain at `judigot.com/<slug>/`.

## Authentication providers

The workspace supports:

- `github` — GitHub OAuth through oauth2-proxy and Nginx `auth_request`;
- `nginx` — Nginx Basic Authentication;
- `opencode` — OpenCode's built-in username and password.

GitHub is the recommended provider for the personal browser-based workspace.

Rollback is performed by changing `WORKSPACE_AUTH_PROVIDER` in `.env` to `nginx` or `opencode`, supplying the relevant credentials, and rerunning the Nginx deployment.

## Important files

| File | Purpose |
|---|---|
| `scripts/init-github.sh` | Fresh EC2 GitHub-authenticated bootstrap entrypoint |
| `scripts/setup-github-auth.sh` | Installs and configures oauth2-proxy and systemd |
| `scripts/apply-github-auth.sh` | Applies Nginx OAuth enforcement |
| `scripts/deploy-nginx.sh` | Generates, authenticates, validates, and deploys Nginx |
| `scripts/init.sh` | Existing base workspace setup wizard |
| `docs/github-authentication.md` | Detailed authentication architecture and security notes |
| `tests/github-auth.sh` | Authentication configuration integration checks |

## GitHub authentication configuration

| Variable | Description |
|---|---|
| `WORKSPACE_AUTH_PROVIDER` | Set to `github` |
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App client secret |
| `GITHUB_ALLOWED_USERS` | Comma-separated GitHub usernames allowed to enter |
| `OAUTH2_PROXY_COOKIE_SECRET` | Secret used to protect browser sessions |
| `OAUTH2_PROXY_PORT` | Local oauth2-proxy port, default `4180` |
| `OPENCODE_SUBDOMAIN` | Protected development hostname |

Never commit the real client secret or cookie secret.