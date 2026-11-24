# Cloud Workspace

Mobile-first development workspace for the **T3 workflow**. Vibe code from your
phone — open your app, tap the chat bubble, tell the AI what to change, see it
live. The same hostnames apply to every app you
run on this workspace, not one product repo.

## Hostnames

These DNS names are the shared platform contract. App repos link here instead
of redefining domains.

| Host | Purpose |
|------|---------|
| `https://dev.judigot.com` | Dev surface — T3/OpenCode, auth-protected Metro/Vite previews, DevBubble injection (`dev.judigot.com/<slug>/`) |
| `https://judigot.com` | Built / client-facing apps — WorkspaceShell at `/`, clean public app pages at `/<slug>/` (no DevBubble) |
| `https://db.judigot.com` | Database viewer — HTTPS front door for Drizzle Gateway (or similar) against the EC2 Postgres used while developing |
| `https://dev.judigot.com/wanderapp/build` | Wanderapp native build console (Android APK today; iOS later). Not a product app route on `judigot.com`. |

Route 53 should point all three names at the workspace EC2 public IPv4. Nginx
terminates TLS for each. Keep ACME challenge locations when renewing certs.

`db.judigot.com` is a convenience for agents and humans on this host. Treat it
as a temporary personal surface: prefer read-only DB roles, and stop the
gateway when you are not using it.

### What belongs where

| Concern | Repository |
|---------|------------|
| Hostnames, nginx, T3 Connect, DevBubble, workspace shell | **This repo** (`judigot/cloud-workspace`) |
| App schema, seeds, Expo/EAS, product env | The app repo (for example `judigot/wanderapp`) |
| Cross-app CI secrets such as `EXPO_TOKEN` | Shared Infisical project (for example `platform` / `shared-ci`), synced into each GitHub repo that needs EAS |
| App-specific Infisical (`DATABASE_URL`, `EXPO_PUBLIC_*`) | Per-app Infisical project with folders such as `/api`, `/travel`, `/ci` |

An Expo access token is account-scoped. One `EXPO_TOKEN` can build multiple
Expo apps under the same Expo account. Keep it in shared CI secrets, not only
inside one product Infisical project.

### T3 agent sessions on this host

- Agents run through T3 Code / T3 Connect against this EC2 workspace.
- Prefer `dev.judigot.com` for live previews the agent and phone share.
- Prefer `judigot.com` for built surfaces you would show as “the app.”
- Use `db.judigot.com` only for inspecting the local workspace database.
- Git over SSH on this host uses the configured `Host github.com` key
  (`IdentityFile` in `~/.ssh/config`). The GitHub CLI (`gh`) needs its own
  `gh auth login` for Actions and PR APIs; SSH alone is not enough.

### ChatGPT-to-T3 host and recovery

This repository covers host provisioning and recovery. The canonical integration
contract, API and client instructions belong in the
[ChatGPT-to-T3 orchestrator guide](https://github.com/judigot/agent-workspace/blob/main/docs/chatgpt-t3-orchestrator.md)
in `judigot/agent-workspace`. See also the
[Grok runtime runbook](https://github.com/judigot/agent-workspace/blob/main/docs/grok-t3-runtime.md)
and [ngrok runbook](https://github.com/judigot/agent-workspace/blob/main/docs/ngrok.md).
The canonical guide link is pending publication in that repository.

The existing Grok-host path has T3 and a REST bridge on the host, with ngrok
providing public access to the configured upstream. ChatGPT reaches the bridge
through its configured public route; a T3 client can reach T3 through its own
configured route. Keep the bridge and T3 upstreams distinct and verify the
actual tunnel targets and access policies. This topology can run on another
authorized host, but an EC2 migration has not been tested. Use the existing
authorized provider and billing route; do not switch to a paid API route as a
recovery step.

After a reset or outage, preserve local T3 data, uncommitted work, configuration
and credentials. Inspect the actual running processes, ports, bridge upstream,
tunnel account, target and access policy before restarting anything; do not
reinstall or overwrite them as a first step. Verify in order:

1. Check that T3 responds locally on its configured address and that the
   bridge's local health endpoint responds. Verify the bridge can reach its
   configured T3 upstream.
2. Check public bridge health through the configured tunnel, then perform the
   authenticated list operation described in the canonical guide. A public
   health response alone does not prove authentication or T3 connectivity.
3. If the public endpoint returns `ERR_NGROK_3200`, investigate the offline
   tunnel and its verified target using the ngrok runbook; recheck local
   services before the public route. An offline host cannot be repaired by
   redeploying the ChatGPT Site.

A stable tunnel address is not storage, a backup, or a running service. Local
threads and credentials remain dependent on the host; unattended recovery is
not established merely by having a reserved address or a watchdog. The tracked
[`scripts/devbox-up.sh`](scripts/devbox-up.sh) differs from the newer host
startup and watchdog described in the ngrok runbook. Reconcile that drift as a
separate follow-up; do not assume the tracked script reproduces the current
host configuration.

## User Journeys

### Journey 0: T3 Code + T3 Connect (Fresh EC2)

Paste this single block on a brand-new Ubuntu EC2 (`ubuntu` user). Ends with T3
running and reachable from the T3 phone app / [app.t3.codes](https://app.t3.codes)
via T3 Connect. Safe to re-run (never deletes existing `~/workspace`).

**Interactive prompts** (marked in the script output; do these when asked):

1. GitHub SSH key — `installgithub` / `usessh`
2. AWS / Bitwarden — `authaws`
3. T3 Connect sign-in / pairing — URL or code during bootstrap

```bash
set -euo pipefail

# Optional: test a branch before merge — CW_REF=my-branch
export CW_REF="${CW_REF:-main}"

. <(curl -fsSL "https://raw.githubusercontent.com/judigot/user/main/load-devrc.sh?cachebustkey=$(date +%s)")
# load-devrc helpers are aliases; enable them (and avoid wrapping this block in
# `(...)` — bash would parse the whole subshell before shopt can take effect).
shopt -s expand_aliases

initubuntu
installnodeenv

# --- interactive: GitHub SSH ---
installgithub
usessh

# --- interactive: AWS / Bitwarden ---
installaws
authaws
unset BW_SESSION

# Clone ~/workspace (idempotent guard) + install/start T3 + T3 Connect
# --- interactive: T3 Connect sign-in / pairing (inside the script) ---
# Process substitution keeps stdin free for prompts (curl|sh would steal it).
bash <(curl -fsSL "https://raw.githubusercontent.com/judigot/cloud-workspace/${CW_REF}/scripts/ec2-t3-bootstrap.sh?cachebustkey=$(date +%s)")
```

Verified against `t3` v0.1.11 (`t3 up --connect --no-lan --headless` installs
the user systemd unit `t3code.service` and enables T3 Connect). Older builds
without `t3 up` fall back to `t3 serve` in tmux plus a user unit. Set
`CW_REF` to try a branch before merging (raw script URL + fresh `git clone --branch`).

#### Verify

```bash
t3 --version
t3 status
t3 service status
t3 connect status
systemctl --user status t3code.service
```

On the phone: open the T3 app or https://app.t3.codes and confirm this host is
online. Optional QR: `t3 pair`.

#### Troubleshooting

| Symptom | What to do |
|---------|------------|
| T3 not reachable from phone / app.t3.codes | `t3 connect status`. If the tunnel is offline, refresh app.t3.codes (or the phone app), wait ~1 minute, then re-check. |
| Tunnel stays offline | `journalctl --user -u t3code.service -n 80 --no-pager` and `t3 doctor`. Re-run `t3 up --connect --no-lan --headless` (or the bootstrap script). |
| Service dead after SSH logout | Enable linger: `sudo loginctl enable-linger ubuntu`, then `t3 service restart`. |
| Need a fresh pairing code | `t3 pair` |
| Fallback path (no `t3 up`) | `tmux attach -t t3code` · logs: `tmux capture-pane -t t3code:serve -p` then inspect the pane |

Re-run the same paste block, or just:

```bash
export CW_REF="${CW_REF:-main}"
bash <(curl -fsSL "https://raw.githubusercontent.com/judigot/cloud-workspace/${CW_REF}/scripts/ec2-t3-bootstrap.sh?cachebustkey=$(date +%s)")
```

---

### Journey 1: Initial Setup (Fresh EC2)

You just ran `terraform apply` and have an IP address.

**Step 1 — Bootstrap the system**

SSH into the instance and load the devrc toolchain:

```bash
(
  set -euo pipefail

  . <(curl -fsSL "https://raw.githubusercontent.com/judigot/user/main/load-devrc.sh?cachebustkey=$(date +%s)")

  # Preserve .env across re-clone (holds domain, creds, API keys)
  [ -f ~/workspace/.env ] && cp ~/workspace/.env /tmp/workspace-env-backup

  initubuntu
  installnodeenv
  installgithub
  usessh
  installaws
  authaws
  cd ~ && \
  rm -rf ~/workspace && \
  git clone git@github.com:judigot/cloud-workspace.git ~/workspace && \
  cd ~/workspace && \
  if [ -f /tmp/workspace-env-backup ]; then mv /tmp/workspace-env-backup ~/workspace/.env; fi && \
  if [ -f .env ]; then :; else cp .env.example .env; fi && \
  ./scripts/init.sh
)
```

The wizard prompts for:
- Domain (default: `judigot.com`)
- Authentication provider (`nginx` or `opencode`, default: `nginx`)
- Username and password for the selected auth provider

Then it automatically:
1. Installs the pinned OpenCode version (`opencode-ai@1.4.0`)
2. Issues TLS certificates (`certbot --standalone`)
3. Generates and deploys the nginx config with SSL
4. Creates and starts the `opencode.service` systemd unit
5. Installs dashboard deps and starts the dashboard services

**Step 2 — Open the browser**

| URL | What you see |
|-----|-------------|
| `https://judigot.com` | Workspace — OpenCode shell with apps/files panels; built app routes |
| `https://dev.judigot.com` | Dev surface — OpenCode / T3 (also embedded in the workspace shell) |
| `https://db.judigot.com` | Database viewer (Drizzle Gateway) for the local workspace Postgres |

---

### Journey 2: Create an App via OpenCode

Open OpenCode at `dev.judigot.com` (or from the chat bubble inside any app). Ask it to create an app.

> "Create a new React app called my-app"

OpenCode (via the `create-app` agent) will:
1. Scaffold `~/my-app` with Vite + React + TypeScript
2. Configure `vite.config.ts` with the correct base path, HMR, and port
3. Run `~/workspace/scripts/add-app.sh my-app frontend 5177`
4. Start the dev server

Result:
- `https://judigot.com/my-app/` is live
- Apps panel at `judigot.com` shows it with icon/title/status metadata
- Open the Apps bubble to navigate to it; the DevBubble on the app page has the same shell

Full-stack apps work too:

> "Create a full-stack app called my-api with a Hono backend"

```sh
# What the agent runs:
~/workspace/scripts/add-app.sh my-api fullstack 3000 5000 ws
```

---

### Journey 3: Vibe Code from Your Phone

This is the core workflow. You're on your phone.

**Step 1** — Open `judigot.com`. You see the **WorkspaceShell**: OpenCode in the main view, with dedicated panels for apps, files, and terminal in the same shell.

```
┌─────────────────────────┐
│     Workspace Shell     │
├─────────────────────────┤
│                         │
│        OpenCode         │
│                         │
│                         │
└─────────────────────────┘
```

**Step 2** — Tap the scaffolder chip. The browser navigates to `judigot.com/scaffolder/` — a clean public page with no dev bubble injected.

```
┌─────────────────────────┐
│  judigot.com/scaffolder │
│                         │
│     Your app runs as    │
│     a native page       │
│                         │
│                  🟣      │
│                  bubble  │
└─────────────────────────┘
```

For development pages, use `dev.judigot.com/<slug>/`. The DevBubble widget is injected there by nginx (`sub_filter`) and the whole dev subdomain is auth-protected. Public app pages at `judigot.com/<slug>/` stay clean for client viewing.

**Step 3** — You see something you want to change. Tap the chat bubble. It opens the same WorkspaceShell inside a fullscreen overlay with assistant, terminal, apps, and files panels.

**Step 4** — Tell OpenCode what you want:

> "Change the header background to red"

OpenCode edits the code. Vite HMR picks up the change. **You see it instantly.**

**Step 5** — Tap minimize. You're back to your app with the change applied. Keep going.

This is the loop:

```
Look at app → Tap bubble → Tell AI what to change → See it live → Repeat
```

No editor. No terminal. No laptop. Just your phone and the running app.

---

### Journey 4: Navigate Between Apps

The public and dev surfaces now have different purposes:

- `judigot.com/<slug>/` — clean client-facing app page, no dev widget injected
- `dev.judigot.com/<slug>/` — auth-protected development view with the DevBubble and full workspace shell

Inside the DevBubble panel, the shared **WorkspaceShell** gives you:

- **Assistant** — OpenCode chat
- **Terminal** — shell access
- **Apps** — searchable launcher with icon/title/status metadata
- **Files** — searchable uploaded asset picker

On app pages, the DevBubble appears as a draggable floating button (bottom-right, like a Messenger chat head):
- Minimized: exactly one floating bubble is visible and snapped to the screen edge
- Tap to expand — opens the WorkspaceShell in a fullscreen overlay
- Expanded: the collapsed bubble stays at the dock edge and the remaining bubbles fan out beside it (`terminal`, `apps`, `files`, then `home`)
- Tap any panel bubble once — switch the content to that panel
- Tap the currently active bubble again — minimize, and that same bubble becomes the new floating minimized identity
- Tap Home — navigates back to `judigot.com`

**How it works:** The `WorkspaceShell` is a single React component shared by both contexts. On `judigot.com` it renders as the full page workspace. On `dev.judigot.com/<slug>/`, nginx injects a `<script>` tag via `sub_filter` that loads a self-contained bundle (`/dev-bubble.js`) and renders the shell inside the bubble's overlay panel.

---

### Journey 5: Add an App Manually

```sh
# Frontend only (Vite)
~/workspace/scripts/add-app.sh my-app 5177

# Full-stack (Vite frontend + API backend + websockets)
~/workspace/scripts/add-app.sh my-api fullstack 3000 5000 ws

# Laravel
~/workspace/scripts/add-app.sh admin laravel 8000
```

The dashboard picks up new apps automatically (reads `.env` live).

---

### Journey 6: Re-run init (Idempotent)

```sh
cd ~/workspace && ./scripts/init.sh
```

Reads `.env` for defaults. Skips certs if they already exist on disk. Restarts services cleanly.

---

## Architecture

```
judigot.com
        │
        ▼
   Nginx (:443, SSL)
        │
        ├─ /              → Dashboard Vite (:3200)  ← WorkspaceShell (OpenCode + apps/files panels)
        ├─ /api/*         → Dashboard Hono API (:3100)
        │                   reads .env, checks port health
        ├─ /dev-bubble.js → Static widget bundle (/var/www/static/)
        ├─ /<slug>/       → Public / built app frontend route (clean, no widget)
        ├─ /<slug>/api/   → App backend API (fullstack only)
        ├─ /<slug>/ws     → App websocket (fullstack+ws)
        └─ /<slug>/       → App backend + sub_filter (laravel)

dev.judigot.com → OpenCode / T3 (:4097, auth + live preview routes with widget injection)
db.judigot.com  → Drizzle Gateway (loopback DB viewer; prefer read-only Postgres role)
```

**Unified WorkspaceShell:**

Both `judigot.com` and the DevBubble overlay render the same `WorkspaceShell` React component:
```
┌────────────────────────────────────────┐
│ [app1 ●] [app2 ●] [app3 ○]  ← strip  │
├────────────────────────────────────────┤
│              OpenCode iframe           │
└────────────────────────────────────────┘
```

**DevBubble injection (nginx `sub_filter`):**

For every app location, nginx rewrites the HTML response:
```
sub_filter '</body>' '<script src="/dev-bubble.js" data-opencode-url="..." data-dashboard-url="..."></script></body>';
```
The widget bundle includes React+ReactDOM and the `WorkspaceShell` component.

**The vibe-coding loop:**

```
Phone → judigot.com (WorkspaceShell) → tap app chip → /scaffolder/
                                                          │
                                                app loads as native page
                                                DevBubble injected by nginx
                                                          │
                                                tap bubble → WorkspaceShell overlay
                                                          │
                                                "change X" → AI edits code
                                                          │
                                                Vite HMR → change visible instantly
                                                          │
                                                minimize → back to app
```

## App Types

| Type | Command | Nginx routes generated |
|------|---------|----------------------|
| `frontend` | `add-app.sh my-app 5177` | `/<slug>/` → Vite, `/<slug>/__vite_hmr` → HMR |
| `fullstack` | `add-app.sh my-api fullstack 3000 5000 ws` | Above + `/<slug>/api/` → backend, `/<slug>/ws` → websocket |
| `laravel` | `add-app.sh admin laravel 8000` | `/<slug>/` → PHP backend |

## Repos

| Directory | Purpose |
|-----------|---------|
| `~/workspace` | Monorepo root — nginx config, init wizard, scripts, agents |
| `~/workspace/dashboard` | Dashboard React app + Hono API + DevBubble package |

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/init.sh` | Full setup wizard — run once after clone |
| `scripts/add-app.sh` | Register a new app (frontend/fullstack/laravel) and redeploy nginx |
| `scripts/deploy-nginx.sh` | Regenerate + deploy nginx config + copy widget bundle to `/var/www/static/` |
| `scripts/generate-nginx.sh` | Generate nginx.conf from env vars (includes `sub_filter` injection) |
| `scripts/health-check.sh` | Smoke test all endpoints |
| `scripts/ec2-t3-bootstrap.sh` | Fresh EC2: idempotent `~/workspace` clone guard + T3 Code / T3 Connect (`t3 up` → `t3code.service`) |
| `scripts/devbox-up.sh` | Older Grok-host startup script; differs from the newer host startup and watchdog described above |

## Configuration

All config lives in `.env` (created by `init.sh`). See `.env.example` for reference.

| Variable | Default | Description |
|----------|---------|-------------|
| `DOMAIN` | `judigot.com` | Primary domain |
| `OPENCODE_PORT` | `4097` | OpenCode listening port |
| `WORKSPACE_AUTH_PROVIDER` | `nginx` | Auth provider for the dev surface (`nginx` or `opencode`) |
| `WORKSPACE_AUTH_USERNAME` | — | Basic auth username for the selected provider |
| `WORKSPACE_AUTH_PASSWORD` | — | Basic auth password for the selected provider |
| `ANTHROPIC_API_KEY` | — | API key for OpenCode |
| `APPS` | `""` | Registered apps (`slug:type:port[:backend_port[:options]]`) |
| `DASHBOARD_PORT` | `3200` | Dashboard Vite dev server port |
| `DASHBOARD_API_PORT` | `3100` | Dashboard Hono API port |
| `DEFAULT_APP` | `""` | App slug to show on `/` instead of the dashboard grid (e.g. `scaffolder`) |
