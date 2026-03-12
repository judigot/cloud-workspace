# Workspace

Mobile-first development workspace. Vibe code from your phone — open your app, tap the chat bubble, tell the AI what to change, see it live.

## User Journeys

### Journey 1: Initial Setup (Fresh EC2)

You just ran `terraform apply` and have an IP address.

**Step 1 — Bootstrap the system**

SSH into the instance and load the devrc toolchain:

```sh
set -euo pipefail

. <(curl -fsSL "https://raw.githubusercontent.com/judigot/user/main/load-devrc.sh?cachebustkey=$(date +%s)")

# Preserve .env across re-clone (holds domain, creds, API keys)
[ -f ~/workspace/.env ] && cp ~/workspace/.env /tmp/workspace-env-backup

initubuntu && \
installnodeenv && \
usessh && \
cd ~ && \
rm -rf ~/workspace && \
git clone git@github.com:judigot/workspace.git ~/workspace && \
cd ~/workspace && \
if [ -f /tmp/workspace-env-backup ]; then mv /tmp/workspace-env-backup ~/workspace/.env; fi && \
if [ -f .env ]; then :; else cp .env.example .env; fi && \
./scripts/init.sh
```

The wizard prompts for:
- Domain (default: `judigot.com`)
- OpenCode username and password (basic auth)
- Anthropic API key (optional — skip if already configured)

Then it automatically:
1. Installs opencode (via `installOpenCode` from `.devrc`)
2. Issues TLS certificates (`certbot --standalone`)
3. Generates and deploys the nginx config with SSL
4. Creates and starts the `opencode.service` systemd unit
5. Installs dashboard deps and starts the dashboard services

**Step 2 — Open the browser**

| URL | What you see |
|-----|-------------|
| `https://judigot.com` | Workspace — OpenCode shell with apps/files panels |
| `https://opencode.judigot.com` | OpenCode (standalone, also embedded in the workspace shell) |

---

### Journey 2: Create an App via OpenCode

Open OpenCode at `opencode.judigot.com` (or from the chat bubble inside any app). Ask it to create an app.

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

**Step 2** — Tap the scaffolder chip. The browser navigates to `judigot.com/scaffolder/` — a native page (not an iframe).

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

The DevBubble widget is automatically injected by nginx (`sub_filter`). No app code changes needed.

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

Both `judigot.com` and the DevBubble panel show the same **WorkspaceShell** UI:

- **App strip** (top) — horizontal scrollable chips for each registered app
  - **Green dot** = dev server running
  - **Gray dot** = dev server stopped
  - Tap a chip to navigate the browser to that app
  - Current app is highlighted
- **OpenCode** (below) — AI coding assistant filling the remaining space

On app pages, the DevBubble appears as a draggable floating button (bottom-right, like a Messenger chat head):
- Minimized: exactly one floating bubble is visible and snapped to the screen edge
- Tap to expand — opens the WorkspaceShell in a fullscreen overlay
- Expanded: the collapsed bubble stays at the dock edge and the remaining bubbles fan out beside it (`terminal`, `apps`, `files`, then `home`)
- Tap any panel bubble once — switch the content to that panel
- Tap the currently active bubble again — minimize, and that same bubble becomes the new floating minimized identity
- Tap Home — navigates back to `judigot.com`

**How it works:** The `WorkspaceShell` is a single React component shared by both contexts. On `judigot.com` it renders as the full page. On app pages, nginx injects a `<script>` tag via `sub_filter` that loads a self-contained bundle (`/dev-bubble.js`, ~62KB gzipped) which renders the shell inside the bubble's overlay panel.

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
        ├─ /<slug>/       → App Vite frontend + sub_filter injects DevBubble
        ├─ /<slug>/api/   → App backend API (fullstack only)
        ├─ /<slug>/ws     → App websocket (fullstack+ws)
        └─ /<slug>/       → App backend + sub_filter (laravel)

opencode.judigot.com → OpenCode (:4097, auth injected by nginx)
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

## Configuration

All config lives in `.env` (created by `init.sh`). See `.env.example` for reference.

| Variable | Default | Description |
|----------|---------|-------------|
| `DOMAIN` | `judigot.com` | Primary domain |
| `OPENCODE_PORT` | `4097` | OpenCode listening port |
| `OPENCODE_SERVER_USERNAME` | — | Basic auth username |
| `OPENCODE_SERVER_PASSWORD` | — | Basic auth password |
| `ANTHROPIC_API_KEY` | — | API key for OpenCode (optional in init) |
| `APPS` | `""` | Registered apps (`slug:type:port[:backend_port[:options]]`) |
| `DASHBOARD_PORT` | `3200` | Dashboard Vite dev server port |
| `DASHBOARD_API_PORT` | `3100` | Dashboard Hono API port |
| `DEFAULT_APP` | `""` | App slug to show on `/` instead of the dashboard grid (e.g. `scaffolder`) |
