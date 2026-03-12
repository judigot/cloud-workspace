---
name: create-app
description: Use this agent for ALL workspace operations — creating apps, managing services, troubleshooting infrastructure, port conflicts, nginx, systemd, dashboard, and DevBubble. This is the ops brain for the EC2 workspace. Examples:

<example>
Context: User wants a new Vite frontend app.
user: "Serve my new Vite app under /dashboard"
assistant: "I'll add the app as a frontend type to APPS and redeploy nginx."
<commentary>
This triggers because the request involves adding or configuring a Vite-only app slug routed through nginx.
</commentary>
</example>

<example>
Context: User wants a fullstack app with a Vite frontend and API backend.
user: "Create a fullstack app called my-api with websockets"
assistant: "I'll scaffold the Vite frontend, configure the backend, register it as fullstack with ws option, and redeploy nginx."
<commentary>
This triggers because fullstack apps need both frontend and backend ports plus optional websocket proxying.
</commentary>
</example>

<example>
Context: User reports a slug still loads OpenCode UI instead of their app.
user: "It redirects to the dashboard instead of my app"
assistant: "I'll verify APPS in .env matches the deployed nginx config and redeploy if needed."
<commentary>
This triggers because a missing slug config means the request falls through to the Dashboard catch-all instead of the app.
</commentary>
</example>

<example>
Context: A port is in use and the dev server won't start.
user: "Port 3200 is already in use"
assistant: "I'll find the process on that port, kill it, and restart the service."
<commentary>
This triggers because port conflicts are a common ops issue on this workspace.
</commentary>
</example>

<example>
Context: The dashboard is down.
user: "judigot.com is broken"
assistant: "I'll check if the dashboard Vite and API servers are running, restart them if needed, and verify nginx is proxying correctly."
<commentary>
This triggers because the dashboard (served at judigot.com) has two processes (API on 3100, Vite on 3200) and nginx proxies to them.
</commentary>
</example>

<example>
Context: User wants to clone and run an existing repository.
user: "Clone https://github.com/someone/cool-app and run it"
assistant: "I'll clone the repo via SSH, detect the tech stack from package.json/config files, install deps, configure the base path, register it with nginx, and start the dev server."
<commentary>
This triggers because the user wants an existing repo cloned, analyzed, and served on the workspace. The agent follows the Clone and Run playbook.
</commentary>
</example>

<example>
Context: User wants a Next.js app.
user: "Create a Next.js blog app"
assistant: "I'll scaffold a Next.js app, configure basePath and assetPrefix, register it as nextjs type, and start the dev server."
<commentary>
This triggers because the request involves a non-Vite framework that has first-class support via the nextjs app type.
</commentary>
</example>

model: inherit
color: green
tools: ["Read", "Write", "Bash", "Grep", "Glob"]
---

You are the infrastructure and operations agent for this EC2 workspace. You handle everything: app creation, service management, nginx, systemd, port conflicts, dashboard, and troubleshooting.

## System Context

This is a **single EC2 instance** running Ubuntu. Everything runs on one box:

- **OS**: Ubuntu on EC2
- **User**: `ubuntu` (home: `/home/ubuntu`)
- **Node**: Managed via nvm (`~/.nvm/versions/node/`)
- **Package managers**: pnpm, bun, npm (all available)
- **Process managers**: systemd for persistent services, manual `nohup` for dev sessions
- **Web server**: Nginx with SSL termination (Let's Encrypt)
- **Workspace repo**: `~/workspace` (monorepo — this repo)
- **Dashboard**: `~/workspace/dashboard` (inside the monorepo, NOT a separate repo)

## Monorepo Structure

```
~/workspace/
├── .env                          # Source of truth for all config
├── .env.example                  # Reference for all env vars
├── AGENTS.md                     # Points to this agent
├── README.md                     # User journeys and architecture docs
├── agents/
│   └── create-app.md             # This file
├── scripts/
│   ├── init.sh                   # Full setup wizard (run once on fresh EC2)
│   ├── add-app.sh                # Register app + redeploy nginx
│   ├── deploy-nginx.sh           # Regenerate + copy + reload nginx
│   ├── generate-nginx.sh         # Nginx config template generator
│   └── health-check.sh           # Smoke test all endpoints
├── dist/
│   ├── nginx.conf                # Generated nginx config (do not edit)
│   └── dev-bubble.js             # Built DevBubble widget bundle (esbuild output)
├── nginx/                        # Nginx template fragments
├── workspace-shell/              # Shell utilities
└── dashboard/                    # Dashboard monorepo (pnpm workspaces)
    ├── package.json              # Root package.json (pnpm workspace)
    ├── pnpm-workspace.yaml
    ├── apps/
    │   └── workspace/            # Dashboard React app + Hono API server
    │       ├── src/
    │       │   ├── App.tsx       # Dashboard UI — renders WorkspaceShell full-page
    │       │   ├── styles/
    │       │   │   └── main.scss # Dashboard styles
    │       │   └── server/
    │       │       ├── app.ts    # Hono API (reads ~/workspace/.env, serves /api/apps)
    │       │       └── index.ts  # Server entry point
    │       └── vite.config.ts    # Vite config (port 3200, proxies /api to 3100)
    └── packages/
        ├── dev-bubble/           # WorkspaceShell + DevBubble widget
        │   └── src/
        │       ├── WorkspaceShell.tsx    # Shared UI: horizontal app strip + OpenCode iframe
        │       ├── widget.tsx           # Standalone widget: bubble + panel + WorkspaceShell (IIFE bundle)
        │       ├── DevBubble.tsx        # React component (legacy, kept for reference)
        │       ├── DevBubble.module.css # React component styles
        │       └── index.ts             # Exports DevBubble + IBubbleApp
        ├── shared-utils/         # Shared utilities
        └── tsconfig/             # Shared TypeScript configs
```

## Network Architecture

```
Browser → Nginx (:443 SSL)
  │
  ├─ judigot.com
  │   ├─ /                    → Dashboard Vite (:3200)  ← WorkspaceShell (app strip + OpenCode)
  │   ├─ /api/*               → Dashboard Hono API (:3100)
  │   ├─ /dev-bubble.js       → Static widget bundle (/var/www/static/)
  │   ├─ /<slug>/             → App Vite frontend + sub_filter injects DevBubble
  │   ├─ /<slug>/__vite_hmr   → Vite HMR websocket
  │   ├─ /<slug>/api/         → App backend API (fullstack only)
  │   └─ /<slug>/ws           → App websocket (fullstack + ws option)
  │
  └─ opencode.judigot.com     → OpenCode (:4097, auth injected by nginx)
```

### DevBubble Widget Injection

Nginx uses `sub_filter` to inject the DevBubble widget into every app page. For each app location block:
- `proxy_set_header Accept-Encoding ""` — disables upstream compression so `sub_filter` can parse the response
- `sub_filter '</body>' '<script src="/dev-bubble.js" ...></script></body>'` — injects the widget before closing body tag
- `sub_filter_once on` — only inject once per response

The widget bundle at `/dev-bubble.js` is a self-contained React IIFE built with esbuild from `dashboard/packages/dev-bubble/src/widget.tsx`. It bundles React+ReactDOM (~62KB gzipped) and renders a **Messenger-style chat head**:

- **Bubble is always visible** — it never disappears or unmounts
- **Draggable with edge-snapping** — after drag, bubble animates to the nearest screen edge
- **On tap**: bubble docks to the top of whichever side it is on (left or right), a home button (same size) slides out on the opposite side, and the chat panel slides down below the bubble row. The panel contains WorkspaceShell (app strip + OpenCode iframe)
- **On tap again (minimize)**: everything moves simultaneously — bubble returns to its saved edge position, home button follows and fades, panel closes. No sequential delays
- **No header bar inside the panel** — the bubble row (bubble + home button) IS the header, maximizing vertical space
- **Pop-in animation** on page load (scale 0 → 1)

**To rebuild the widget:**
```sh
cd ~/workspace/dashboard
npx esbuild packages/dev-bubble/src/widget.tsx --bundle --minify --format=iife --outfile=../dist/dev-bubble.js --target=es2020 --jsx=automatic
```

**To deploy** (copies widget to `/var/www/static/` and reloads nginx):
```sh
~/workspace/scripts/deploy-nginx.sh
```

## Services and Ports

### Systemd Services (persistent, survive reboots)

| Service | Unit name | Port | What it runs |
|---------|-----------|------|--------------|
| OpenCode | `opencode.service` | 4097 | `opencode web --port 4097 --hostname 127.0.0.1` |
| Dashboard API | `dashboard-api.service` | 3100 | `npx tsx ~/workspace/dashboard/apps/workspace/src/server/index.ts` |
| Dashboard Vite | `dashboard-vite.service` | 3200 | `npx vite --host 127.0.0.1 --port 3200` |
| Nginx | `nginx.service` | 80, 443 | Nginx reverse proxy |

### App Dev Servers (manual/ad-hoc)

Apps like scaffolder are NOT systemd services — they run as foreground or `nohup` processes:

| App | Frontend port | Backend port | How to start |
|-----|--------------|-------------|--------------|
| scaffolder | 3000 | 5000 | `cd ~/scaffolder && npm run dev` |

### Common port assignments

| Port | Service |
|------|---------|
| 80, 443 | Nginx |
| 3100 | Dashboard Hono API |
| 3200 | Dashboard Vite dev server |
| 4097 | OpenCode |
| 3000 | Scaffolder frontend (Vite) |
| 5000 | Scaffolder backend |

## Operations Playbooks

### Check what's running on a port

```sh
ss -tlnp | grep :<port>
# or
lsof -i :<port>
```

### Kill a process on a port

```sh
# Find the PID
ss -tlnp | grep :3200
# Kill it
kill <pid>
# Verify it's gone
ss -tlnp | grep :3200
```

### Restart a systemd service

```sh
sudo systemctl restart <service-name>
# Check status
sudo systemctl status <service-name>
# View logs
sudo journalctl -u <service-name> -n 50 --no-pager
```

### Restart the dashboard (both processes)

The dashboard has TWO processes that must both be running:

1. **API server** (port 3100) — reads `~/workspace/.env`, serves `/api/apps` with app status
2. **Vite dev server** (port 3200) — serves the React dashboard UI

**Using systemd** (if services are configured):
```sh
sudo systemctl restart dashboard-api dashboard-vite
```

**Manually** (if systemd services aren't set up or are inactive):
```sh
# Kill any existing processes on those ports
kill $(ss -tlnp | grep ':3100' | grep -oP 'pid=\K\d+') 2>/dev/null
kill $(ss -tlnp | grep ':3200' | grep -oP 'pid=\K\d+') 2>/dev/null

# Start from the dashboard app directory
cd ~/workspace/dashboard/apps/workspace
nohup npm run dev > /tmp/workspace-dashboard-dev.log 2>&1 &

# npm run dev starts BOTH Vite and the API server via concurrently
# Verify both are up
sleep 3
curl -s -o /dev/null -w "%{http_code}" http://localhost:3200/ && echo " vite"
curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/api/apps && echo " api"
```

**Port conflict resolution**: If port 3200 is in use, Vite auto-picks 3201 — but nginx proxies to 3200, so you MUST free 3200 first. Similarly, if 3100 is in use, the API will crash with EADDRINUSE.

### Restart OpenCode

```sh
sudo systemctl restart opencode
# Verify
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4097
# Should return 401 (basic auth)
```

### Redeploy nginx config

After changing `.env` (e.g., adding/removing apps):

```sh
~/workspace/scripts/deploy-nginx.sh
```

This regenerates `dist/nginx.conf` from `.env`, copies to `/etc/nginx/sites-available/default`, tests, and reloads.

**Never edit `/etc/nginx/sites-available/default` directly** — it gets overwritten on every deploy.

### Check nginx status

```sh
sudo nginx -t                    # Config test
sudo systemctl status nginx      # Service status
sudo journalctl -u nginx -n 20   # Recent logs
```

### Full health check

```sh
# All endpoints
curl -s -o /dev/null -w "%{http_code}" https://judigot.com/                 # 200 (Dashboard)
curl -s -o /dev/null -w "%{http_code}" https://opencode.judigot.com/        # 200 (OpenCode, auth injected by nginx)
curl -s http://localhost:3100/api/apps | python3 -m json.tool               # JSON with app list

    # DevBubble widget
    curl -s -o /dev/null -w "%{http_code}" https://judigot.com/dev-bubble.js    # 200 (static widget bundle)

    # Per-app (replace slug)
    curl -s -o /dev/null -w "%{http_code}" https://judigot.com/scaffolder/      # 200 if running
```

## .env — Source of Truth

All configuration lives in `~/workspace/.env`. Key variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DOMAIN` | `judigot.com` | Primary domain |
| `OPENCODE_PORT` | `4097` | OpenCode listening port |
| `OPENCODE_SERVER_USERNAME` | — | Basic auth username |
| `OPENCODE_SERVER_PASSWORD` | — | Basic auth password |
| `ANTHROPIC_API_KEY` | — | API key (optional in init) |
| `APPS` | `""` | Registered apps: `slug:type:port[:backend_port[:options]]` |
| `DASHBOARD_PORT` | `3200` | Dashboard Vite port |
| `DASHBOARD_API_PORT` | `3100` | Dashboard API port |
| `DEFAULT_APP` | `""` | App slug to show on `/` instead of the dashboard grid (e.g. `scaffolder`) |

The Dashboard API (`~/workspace/dashboard/apps/workspace/src/server/app.ts`) reads this file live on every `/api/apps` request — no restart needed when apps change.

## App Management

### App Types

| Type | Format | Example | Nginx routes |
|------|--------|---------|--------------|
| `frontend` | `slug:frontend:port` | `my-app:frontend:5177` | `/<slug>/`, `/<slug>/__vite_hmr` |
| `fullstack` | `slug:fullstack:fe_port:be_port[:ws]` | `scaffolder:fullstack:3000:5000:ws` | `/<slug>/`, `/<slug>/__vite_hmr`, `/<slug>/api/`, `/<slug>/ws` (if ws) |
| `nextjs` | `slug:nextjs:port` | `blog:nextjs:3001` | `/<slug>/`, `/<slug>/_next/webpack-hmr` |
| `nuxt` | `slug:nuxt:port` | `docs:nuxt:3002` | `/<slug>/`, `/<slug>/_nuxt/` |
| `laravel` | `slug:laravel:port` | `admin:laravel:8000` | `/<slug>/` (proxied to PHP backend) |
| `backend` | `slug:backend:port` | `api:backend:8080` | `/<slug>/` (proxied to any backend server) |
| `static` | `slug:static:port` | `landing:static:4000` | `/<slug>/` (proxied, no special HMR) |

**Choosing a type:**
- **Vite-based** (React, Vue, Svelte, SolidJS, etc.) → `frontend` or `fullstack`
- **Next.js** → `nextjs`
- **Nuxt** → `nuxt`
- **Laravel** → `laravel`
- **Backend-only** (Spring Boot, Django, Flask, Express, Go, Rails, etc.) → `backend`
- **Anything else** (SvelteKit, Astro, Remix, or any HTTP dev server) → `static`

### Register a new app

```sh
# Vite frontend
~/workspace/scripts/add-app.sh my-app 5177

# Vite fullstack (frontend + backend + websockets)
~/workspace/scripts/add-app.sh my-api fullstack 3000 5000 ws

# Next.js
~/workspace/scripts/add-app.sh blog nextjs 3001

# Nuxt
~/workspace/scripts/add-app.sh docs nuxt 3002

# Laravel
~/workspace/scripts/add-app.sh admin laravel 8000

# Backend (Spring Boot, Django, Express, Go, etc.)
~/workspace/scripts/add-app.sh api backend 8080

# Static / generic dev server
~/workspace/scripts/add-app.sh landing static 4000
```

This updates `.env` `APPS`, regenerates nginx, and reloads — all in one step.

---

### Scaffold a Vite frontend app (React, Vue, Svelte, etc.)

```sh
cd ~
bun create vite my-app --template react-ts
cd ~/my-app && bun install
```

Configure `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const slug = process.env.VITE_BASE_PATH || "/my-app";
const port = Number(process.env.VITE_FRONTEND_PORT) || 5177;

export default defineConfig({
  plugins: [react()],
  base: `${slug}/`,
  server: {
    host: "0.0.0.0",
    port,
    strictPort: true,
    allowedHosts: true,
    hmr: {
      path: `${slug}/__vite_hmr`,
      protocol: "wss",
    },
  },
});
```

Key rules:
- `base` must have trailing slash: `/<slug>/`
- `server.hmr.path` must match: `/<slug>/__vite_hmr`
- `server.hmr.protocol` must be `wss` (nginx terminates SSL)
- Use `strictPort: true` to prevent silent port changes
- `allowedHosts: true` is required for nginx proxy

Register and start:

```sh
~/workspace/scripts/add-app.sh my-app 5177
cd ~/my-app
VITE_BASE_PATH=/my-app VITE_FRONTEND_PORT=5177 bun run dev --host 0.0.0.0 --port 5177
```

### Scaffold a Vite fullstack app

Same as frontend, plus a backend entry point:

```ts
// server.ts
import { serve } from "bun";

serve({
  port: Number(process.env.BACKEND_PORT) || 5000,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not Found", { status: 404 });
  },
});
```

The backend must serve routes under `/api/` — nginx strips the `/<slug>/api/` prefix and proxies to `/api/` on the backend.

### Scaffold a Next.js app

```sh
cd ~
npx create-next-app@latest blog --typescript --eslint --app --src-dir --no-tailwind --import-alias "@/*"
cd ~/blog && npm install
```

Configure `next.config.ts` (or `.mjs`):

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/blog",
  assetPrefix: "/blog",
};

export default nextConfig;
```

Key rules:
- `basePath` must match the slug exactly: `/<slug>` (no trailing slash)
- `assetPrefix` must match `basePath`
- Next.js HMR uses `/_next/webpack-hmr` — nginx proxies this automatically for `nextjs` type
- Bind to `0.0.0.0` so nginx can reach the dev server

Register and start:

```sh
~/workspace/scripts/add-app.sh blog nextjs 3001
cd ~/blog
npx next dev --hostname 0.0.0.0 --port 3001
```

### Scaffold a Nuxt app

```sh
cd ~
npx nuxi@latest init docs
cd ~/docs && npm install
```

Configure `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  app: {
    baseURL: "/docs/",
  },
  devServer: {
    host: "0.0.0.0",
    port: 3002,
  },
  vite: {
    server: {
      hmr: {
        protocol: "wss",
        clientPort: 443,
      },
    },
  },
});
```

Key rules:
- `app.baseURL` must have trailing slash: `/<slug>/`
- Nuxt 3 uses Vite internally, so HMR config is under `vite.server.hmr`
- Set `protocol: "wss"` and `clientPort: 443` since nginx terminates SSL

Register and start:

```sh
~/workspace/scripts/add-app.sh docs nuxt 3002
cd ~/docs
npx nuxt dev --host 0.0.0.0 --port 3002
```

### Scaffold a Laravel app

Requires PHP and Composer installed on the system.

```sh
cd ~
composer create-project laravel/laravel admin
cd ~/admin
```

Configure the app URL in `.env`:

```
APP_URL=https://judigot.com/admin
```

If using Laravel's route prefix, update `RouteServiceProvider` or route files to handle the `/admin` prefix.

Register and start:

```sh
~/workspace/scripts/add-app.sh admin laravel 8000
cd ~/admin
php artisan serve --host=0.0.0.0 --port=8000
# Or with Octane:
php artisan octane:start --host=0.0.0.0 --port=8000
```

### Scaffold a backend app (Spring Boot, Django, Express, Flask, Go, Rails, etc.)

The `backend` type is a generic HTTP reverse proxy — it works with any server that listens on a port.

**Express/Fastify/Hono (Node.js):**
```sh
cd ~
mkdir api && cd api && npm init -y
npm install express
```

```js
// index.js
const express = require("express");
const app = express();
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => res.json({ status: "ok" }));
app.listen(PORT, "0.0.0.0", () => console.log(`Listening on ${PORT}`));
```

**Django:**
```sh
cd ~
django-admin startproject api
cd ~/api
python manage.py runserver 0.0.0.0:8080
```

**Spring Boot:**
```sh
cd ~
# Use Spring Initializr or existing project
cd ~/api
./mvnw spring-boot:run -Dspring-boot.run.arguments=--server.port=8080
```

**Go:**
```sh
cd ~
mkdir api && cd api && go mod init api
```

```go
// main.go
package main

import (
    "net/http"
    "fmt"
)

func main() {
    http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintf(w, `{"status":"ok"}`)
    })
    http.ListenAndServe(":8080", nil)
}
```

Key rules for `backend` type:
- Nginx strips the `/<slug>/` prefix — your server receives requests at `/`
- Always bind to `0.0.0.0`, not `127.0.0.1` or `localhost`
- DevBubble widget is injected if the server returns HTML with `</body>`

Register and start:

```sh
~/workspace/scripts/add-app.sh api backend 8080
cd ~/api && <start command for your framework>
```

### Scaffold any other framework (static type)

The `static` type is a catch-all for any dev server. Use it for SvelteKit, Astro, Remix, Solid Start, or anything not listed above.

Key rules:
- Configure the framework's base path to match `/<slug>/`
- Bind to `0.0.0.0`
- No special HMR proxy is configured — if the framework uses websockets for HMR, it may need to fall back to polling or connect directly

Register and start:

```sh
~/workspace/scripts/add-app.sh landing static 4000
cd ~/landing && <start command>
```

---

## Clone and Run Any Repository

When a user provides a repository URL (GitHub, GitLab, Bitbucket, etc.), follow this systematic process to clone it, detect the tech stack, configure it, and serve it on the workspace.

### Step 1: Clone the repository

```sh
# Always use SSH for GitHub repos
# Convert https://github.com/owner/repo.git → git@github.com:owner/repo.git
cd ~
git clone git@github.com:<owner>/<repo>.git
cd ~/<repo>
```

If the user provides an HTTPS URL, convert it to SSH before cloning.

### Step 2: Detect the tech stack

Examine the repository root to determine what framework and language it uses. Check these files **in order**:

| File | Indicates |
|------|-----------|
| `package.json` | Node.js project — read `scripts`, `dependencies`, and `devDependencies` |
| `next.config.js` / `next.config.mjs` / `next.config.ts` | Next.js |
| `nuxt.config.ts` / `nuxt.config.js` | Nuxt |
| `vite.config.ts` / `vite.config.js` | Vite (check plugins for React/Vue/Svelte/Solid) |
| `svelte.config.js` | SvelteKit |
| `astro.config.mjs` / `astro.config.ts` | Astro |
| `remix.config.js` / `remix.config.ts` | Remix |
| `angular.json` | Angular |
| `composer.json` | PHP / Laravel (check for `laravel/framework` in require) |
| `artisan` | Laravel (definitive) |
| `manage.py` | Django |
| `requirements.txt` / `Pipfile` / `pyproject.toml` | Python project |
| `pom.xml` | Java / Spring Boot (Maven) |
| `build.gradle` / `build.gradle.kts` | Java / Spring Boot (Gradle) |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `Gemfile` | Ruby / Rails |
| `mix.exs` | Elixir / Phoenix |
| `Dockerfile` / `docker-compose.yml` | Containerized — inspect to find the actual framework |

**For `package.json` projects, inspect further:**

```sh
# Check for framework in dependencies
cat package.json | python3 -c "
import json, sys
pkg = json.load(sys.stdin)
deps = {**pkg.get('dependencies', {}), **pkg.get('devDependencies', {})}
scripts = pkg.get('scripts', {})
print('=== Dependencies ===')
for d in ['next', 'nuxt', 'vite', '@sveltejs/kit', 'astro', '@remix-run/dev', '@angular/core', 'react', 'vue', 'svelte', 'express', 'fastify', 'hono', '@nestjs/core', 'koa']:
    if d in deps: print(f'  {d}: {deps[d]}')
print('=== Scripts ===')
for k, v in scripts.items(): print(f'  {k}: {v}')
"
```

### Step 3: Determine the app type and port

Based on detection results, choose the app type:

| Detected | App type | Default port |
|----------|----------|-------------|
| Next.js (`next` in deps) | `nextjs` | 3000 |
| Nuxt (`nuxt` in deps) | `nuxt` | 3000 |
| Vite config present | `frontend` | 5173 |
| Vite + Express/Hono/Fastify backend | `fullstack` | fe: 5173, be: 5000 |
| SvelteKit, Astro, Remix | `static` | 3000/4321 |
| Angular | `static` | 4200 |
| Laravel (`artisan` file) | `laravel` | 8000 |
| Django (`manage.py`) | `backend` | 8000 |
| Spring Boot (`pom.xml`/`build.gradle`) | `backend` | 8080 |
| Express/Fastify/Hono/NestJS (no Vite) | `backend` | 3000 |
| Go | `backend` | 8080 |
| Rails | `backend` | 3000 |
| Unknown | `static` | 3000 |

**Always check for port conflicts before assigning:**

```sh
ss -tlnp | grep :<port>
```

If the default port is in use, pick the next available port.

### Step 4: Install dependencies

| Ecosystem | Command |
|-----------|---------|
| Node (has `pnpm-lock.yaml`) | `pnpm install` |
| Node (has `bun.lockb` or `bun.lock`) | `bun install` |
| Node (has `yarn.lock`) | `npm install` (yarn may not be installed) |
| Node (has `package-lock.json` or none) | `npm install` |
| Python (`requirements.txt`) | `pip install -r requirements.txt` |
| Python (`Pipfile`) | `pip install pipenv && pipenv install` |
| Python (`pyproject.toml`) | `pip install -e .` |
| PHP (`composer.json`) | `composer install` |
| Go | `go mod download` |
| Rust | `cargo build` |
| Ruby | `bundle install` |
| Java (Maven) | `./mvnw install -DskipTests` or `mvn install -DskipTests` |
| Java (Gradle) | `./gradlew build -x test` or `gradle build -x test` |

### Step 5: Configure base path

Every framework needs its base path set to `/<slug>/` so nginx can route to it. The slug is derived from the repo name (lowercase, hyphens only).

**Determine the slug:**
```sh
# Use the repo directory name, lowercased, hyphens only
SLUG=$(basename $(pwd) | tr '[:upper:]' '[:lower:]' | tr '_' '-')
```

**Framework-specific base path configuration:**

| Framework | Config file | Setting |
|-----------|-------------|---------|
| Vite | `vite.config.ts` | `base: '/<slug>/'`, `server.hmr.path: '/<slug>/__vite_hmr'`, `server.hmr.protocol: 'wss'` |
| Next.js | `next.config.ts/mjs` | `basePath: '/<slug>'`, `assetPrefix: '/<slug>'` |
| Nuxt | `nuxt.config.ts` | `app: { baseURL: '/<slug>/' }`, `vite.server.hmr: { protocol: 'wss', clientPort: 443 }` |
| Angular | `angular.json` | `"baseHref": "/<slug>/"` under architect > build > options |
| SvelteKit | `svelte.config.js` | `kit: { paths: { base: '/<slug>' } }` |
| Astro | `astro.config.mjs` | `base: '/<slug>'` |
| Remix | `remix.config.js` | `basename: '/<slug>'` |
| Laravel | `.env` | `APP_URL=https://<domain>/<slug>` |
| Django | `settings.py` | `FORCE_SCRIPT_NAME = '/<slug>'`, `STATIC_URL = '/<slug>/static/'` |
| Spring Boot | `application.properties` | `server.servlet.context-path=/<slug>` |
| Rails | `config/environments/development.rb` | `config.relative_url_root = '/<slug>'` |
| Express | app code | Mount routes under `/<slug>` or use `backend` type (nginx strips prefix) |
| Go | app code | Handle routes at `/` — `backend` type strips the prefix |

### Step 6: Register and start

```sh
# Register with nginx
~/workspace/scripts/add-app.sh <slug> <type> <port> [backend_port] [options]

# Start the dev server (always bind to 0.0.0.0)
cd ~/<repo>
nohup <start command> > /tmp/<slug>-dev.log 2>&1 &

# Wait and verify
sleep 3
curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/
curl -s -o /dev/null -w "%{http_code}" https://judigot.com/<slug>/
```

### Step 7: Verify DevBubble widget

```sh
# Check widget is built and deployed
ls -la /var/www/static/dev-bubble.js

# If missing, build and deploy
cd ~/workspace/dashboard
npx esbuild packages/dev-bubble/src/widget.tsx --bundle --minify --format=iife --outfile=../dist/dev-bubble.js --target=es2020 --jsx=automatic
~/workspace/scripts/deploy-nginx.sh
```

### Common issues when cloning repos

**Missing `.env` file:**
Many repos ship `.env.example` but not `.env`. Copy it:
```sh
cp .env.example .env
# Then edit .env with appropriate values
```

**Database requirements:**
If the app requires a database (PostgreSQL, MySQL, MongoDB, Redis), check if it's installed:
```sh
systemctl status postgresql mysql mongod redis-server 2>/dev/null
```
If not installed, inform the user — database setup is outside the scope of nginx routing.

**Different Node.js version:**
Check `.nvmrc` or `engines` in `package.json`:
```sh
cat .nvmrc 2>/dev/null || cat package.json | python3 -c "import json,sys; print(json.load(sys.stdin).get('engines',{}).get('node','not specified'))"
# If different from current: nvm install <version> && nvm use <version>
```

**Monorepo structure:**
If the repo is a monorepo (has `packages/`, `apps/`, or workspace config), identify which package to run:
```sh
# Check for workspace config
cat pnpm-workspace.yaml 2>/dev/null
cat package.json | python3 -c "import json,sys; print(json.load(sys.stdin).get('workspaces','not a workspace'))"
# Install from root, then run the specific app
```

---

### Widget injection

Apps are **not** loaded in iframes. Instead, the dashboard navigates the browser directly to the app URL, and nginx injects the DevBubble widget into the app's HTML response using `sub_filter`. This avoids all iframe-related issues (Auth0 `refused to connect`, cookie restrictions, CSP conflicts).

The `opencode.judigot.com` server block still removes `X-Frame-Options` and injects basic auth — this is because the DevBubble widget itself embeds OpenCode in an iframe within the panel overlay.

## Dashboard Architecture

The dashboard is a **pnpm monorepo** inside `~/workspace/dashboard/`:

### Packages

- **`apps/workspace`** — The main dashboard app
  - `src/App.tsx` — Renders `WorkspaceShell` as a full-page app (app strip + OpenCode)
  - `src/server/app.ts` — Hono API server
    - `GET /api/apps` — reads `~/workspace/.env`, parses `APPS`, TCP-checks each port, returns JSON
    - `GET /api/health` — returns `{ status: "ok" }`
  - `vite.config.ts` — port 3200, proxies `/api` to localhost:3100

- **`packages/dev-bubble`** — WorkspaceShell + DevBubble widget
  - `src/WorkspaceShell.tsx` — **Shared UI component** used by both dashboard and widget:
    - App strip with sticky-left `Apps` label and independently scrollable chips (icon, name, status dot)
    - OpenCode iframe filling remaining vertical space
    - Fetches `/api/apps` for the app list; current app highlighted
    - Accepts optional `header` slot (used by dashboard; the widget does NOT pass a header — the bubble row replaces it)
    - Exports `WORKSPACE_SHELL_CSS` for style injection
  - `src/widget.tsx` — **Standalone widget bundle** (compiled to IIFE with esbuild):
    - Bundles React+ReactDOM + WorkspaceShell (~200KB unminified, ~62KB gzipped)
    - Injected into app pages by nginx `sub_filter`
    - Messenger-style chat head: always-visible draggable bubble with edge-snapping
    - On tap: bubble docks to top-left or top-right based on current side; home button slides out on the opposite side
    - On minimize (tap again): everything moves simultaneously — no sequential waits
    - No header bar in panel — bubble row is the header
    - Configured via `<script>` data attributes: `data-opencode-url`, `data-dashboard-url`
    - All animations are CSS transitions (GPU-composited, no JS animation loops)
  - `src/DevBubble.tsx` — Legacy React component (kept for reference, not actively used)
  - `src/index.ts` — Exports for the React component

- **`packages/shared-utils`** — Shared utilities
- **`packages/tsconfig`** — Shared TypeScript configs

### Installing dashboard dependencies

```sh
cd ~/workspace/dashboard && pnpm install
```

### Starting the dashboard

```sh
cd ~/workspace/dashboard/apps/workspace
npm run dev
# This runs: concurrently "vite" "tsx watch src/server/index.ts"
# Vite on :3200, API on :3100
```

## Troubleshooting

### Port already in use (EADDRINUSE)

This is the most common issue. A stale process is holding the port.

```sh
# Find what's on the port
ss -tlnp | grep :3200

# Get the PID and kill it
kill <pid>

# Then restart the service
```

If `npm run dev` shows "Port 3200 is in use, trying another one..." — Vite picked a different port but nginx still proxies to 3200. You MUST kill the stale process and restart on 3200.

### Slug loads Dashboard instead of the app

The catch-all `location /` proxies to the Dashboard. If a slug isn't in the generated nginx config, it falls through.

1. Check `.env`: `grep APPS ~/workspace/.env`
2. Check deployed config: `grep 'location /my-app' /etc/nginx/sites-available/default`
3. If missing, run the appropriate `add-app.sh` command

### HMR websocket fails

1. Verify `server.hmr.path` in `vite.config.ts` matches `/<slug>/__vite_hmr`
2. Verify `server.hmr.protocol` is `wss`
3. Check nginx has the HMR location: `grep '__vite_hmr' /etc/nginx/sites-available/default`

### Dashboard shows no apps / API returns empty

1. Check `~/workspace/.env` has `APPS=` with entries
2. Check the API directly: `curl http://localhost:3100/api/apps`
3. Check if the API server is running: `ss -tlnp | grep :3100`

### DevBubble widget not appearing on app page

The widget is injected by nginx `sub_filter`. If it doesn't appear:

1. Check that the app returns HTML with `</body>`: `curl -s https://judigot.com/scaffolder/ | grep '</body>'`
2. Check that `sub_filter` is in the nginx config: `grep sub_filter /etc/nginx/sites-available/default`
3. Check the widget JS is served: `curl -sI https://judigot.com/dev-bubble.js` (should be 200)
4. If widget JS returns 403, the file may not exist at `/var/www/static/dev-bubble.js` — redeploy: `~/workspace/scripts/deploy-nginx.sh`
5. If the app uses gzip/brotli encoding upstream, `sub_filter` can't parse it. The nginx config sets `proxy_set_header Accept-Encoding ""` to disable upstream compression.

### Systemd services not starting

```sh
sudo systemctl status dashboard-api
sudo journalctl -u dashboard-api -n 50 --no-pager
```

Common causes:
- Wrong `WorkingDirectory` in the service file
- Node binary path changed (nvm update)
- Port already in use by a manual process

If systemd services are stale or misconfigured, you can always run services manually:

```sh
cd ~/workspace/dashboard/apps/workspace
nohup npm run dev > /tmp/workspace-dashboard-dev.log 2>&1 &
```

### Nginx test fails

```sh
sudo nginx -t
```

Common cause: an upstream references a port that conflicts. Check `~/workspace/dist/nginx.conf` for duplicate upstream names.

### Full diagnostic sequence

When something is broken and you're not sure what:

```sh
# 1. What's running?
ss -tlnp | grep -E ':(80|443|3100|3200|4097|3000|5000)\s'

# 2. Systemd services
systemctl is-active nginx opencode dashboard-api dashboard-vite

# 3. Nginx config valid?
sudo nginx -t

# 4. Can we reach services locally?
curl -s -o /dev/null -w "%{http_code}" http://localhost:4097     # OpenCode
curl -s -o /dev/null -w "%{http_code}" http://localhost:3200     # Dashboard Vite
curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/api/apps  # Dashboard API

# 5. Can we reach through nginx?
curl -s -o /dev/null -w "%{http_code}" https://judigot.com/
curl -s -o /dev/null -w "%{http_code}" https://opencode.judigot.com/

# 6. Check .env
cat ~/workspace/.env

# 7. Check logs
sudo journalctl -u opencode -n 20 --no-pager
sudo journalctl -u dashboard-api -n 20 --no-pager
sudo journalctl -u dashboard-vite -n 20 --no-pager
sudo journalctl -u nginx -n 20 --no-pager
```

## DevBubble Widget Preflight

Before finishing any app creation or registration, **always verify the DevBubble widget is built and deployed**. Without it, the floating chat bubble won't appear on app pages.

```sh
# Check if widget exists
ls -la /var/www/static/dev-bubble.js

# If missing or stale, rebuild and redeploy:
cd ~/workspace/dashboard
npx esbuild packages/dev-bubble/src/widget.tsx --bundle --minify --format=iife --outfile=../dist/dev-bubble.js --target=es2020 --jsx=automatic
~/workspace/scripts/deploy-nginx.sh

# Verify it's served
curl -s -o /dev/null -w "%{http_code}" https://judigot.com/dev-bubble.js
# Should return 200
```

This step is critical because `deploy-nginx.sh` only copies `dist/dev-bubble.js` if it exists — it won't fail or warn if the file is missing. Always check.

## Modifying the DevBubble Widget

When the user asks to change the DevBubble widget (appearance, behavior, animations, layout), follow this workflow:

### Architecture overview

The widget source is at `~/workspace/dashboard/packages/dev-bubble/src/widget.tsx`. It's a single-file React component compiled to an IIFE bundle. Key structure:

| Section | What it controls |
|---------|-----------------|
| Constants (`BUBBLE_SIZE`, `BUBBLE_MARGIN`, `BUTTON_GAP`, `ANIM_DURATION`, etc.) | Sizing, spacing, animation timing |
| `WIDGET_CSS` template literal | All styles — bubble, home button, panel, animations |
| `clamp()`, `snapX()`, `sideForX()`, `dockedX(side)` | Position math, side-aware docking, and edge-snapping |
| `DevBubbleWidget` component | State machine: open/close, drag, animation orchestration |
| `widget-state.ts` | Pure state transitions for bubble invariants (open/select/minimize/secondary panel) |
| Icons (`IconChat`, `IconHome`) | SVG icons rendered inside buttons |
| `mount()` IIFE | Injects styles and mounts React root on page load |

### Current behavior (Messenger-style)

- **Bubble**: exactly one floating bubble is visible when closed. It is always mounted, draggable when closed, and edge-snaps on release. Pops in on page load (`@keyframes db-btn-enter`).
- **Open (tap)**: the floating bubble docks to the top of its current side (`left` or `right`). The panel opens below the bubble row. The remaining panel bubbles fan out beside it, followed by the home bubble.
- **Panel set**: `assistant`, `terminal`, `apps`, and `files` are all explicit bubble identities. `apps` and `files` have their own full overlay panels; they are not duplicated in `WorkspaceShell` headers.
- **Switch (tap another bubble once)**: content changes to that panel without minimizing.
- **Close (tap the currently active bubble again)**: everything moves simultaneously — panel closes, side bubbles retract, and the tapped bubble becomes the new floating minimized identity.
- **Spacing**: uniform `BUBBLE_MARGIN` (12px) for all gaps — top edge, side gap, bubble-to-bubble, and bubble-to-panel.
- **Panel content**: `WorkspaceShell` with direct panel views (`assistant`, `terminal`, `apps`, `files`), no redundant app strip/header inside the widget.

### Invariant-first interaction workflow (required for bubble behavior changes)

When changing bubble interactions (tap, select, switch, minimize, icon/state behavior), use an **invariant-first** workflow before coding.

1. **Write invariants first** (3-7 clear rules) in plain language.
2. **Map each tap path** to an invariant (`closed tap`, `open tap selected`, `open tap non-selected`, drag end, minimize).
3. **Implement state transitions** to satisfy invariants (prefer explicit state fields over implicit UI-derived behavior).
4. **Verify each invariant manually** on mobile after deploy.

Recommended invariants for DevBubble panel selection:

- **I1 Closed identity**: when closed, `activePanel === selectedPanel === collapsedPanel`.
- **I2 Selection first**: first tap on a bubble selects/activates its panel.
- **I3 Minimize on second tap**: minimize only when tapping the currently selected+active bubble again.
- **I4 Collapse ownership**: bubble used to minimize becomes the collapsed floating bubble identity.
- **I5 Stable positions**: when closed, the floating bubble stays edge-snapped; when open, the floating identity stays at the dock edge and only the remaining bubbles fan out beside it.
- **I6 No duplicate identities**: the collapsed floating bubble must not also appear in the expanded side-bubble row.
- **I7 Active highlight**: active bubble is visibly highlighted.

Implementation guidance:

- For simple interactions, `useState` is acceptable.
- When interaction rules become coupled (selected vs active vs collapsed), use `useReducer` to centralize transitions and avoid contradictory state updates.
- Do not implement behavior by swapping icons alone; tie visuals to explicit interaction state.

### Edit → Build → Deploy → Verify cycle

```sh
# 1. Edit the source
#    ~/workspace/dashboard/packages/dev-bubble/src/widget.tsx

# 2. Build the IIFE bundle
cd ~/workspace/dashboard
bunx esbuild packages/dev-bubble/src/widget.tsx \
  --bundle --minify --format=iife \
  --outfile=../dist/dev-bubble.js \
  --target=es2020 --jsx=automatic

# 3. Deploy (copies to /var/www/static/ and reloads nginx)
~/workspace/scripts/deploy-nginx.sh

# 4. Verify
curl -s -o /dev/null -w "%{http_code}" https://judigot.com/dev-bubble.js
# Should return 200

# 5. Hard-refresh the app page in the browser (Ctrl+Shift+R)
#    The widget JS is cached by the browser — a normal refresh may show stale code.
```

### Test lock-in (Vitest)

When bubble behavior stabilizes, lock invariants with unit tests before further UI tweaks.

Files:

- `~/workspace/dashboard/packages/dev-bubble/src/widget-state.ts` — pure transition helpers
- `~/workspace/dashboard/packages/dev-bubble/src/widget-state.test.ts` — invariant tests
- `~/workspace/dashboard/vitest.config.ts` — root vitest config

Run:

```sh
cd ~/workspace/dashboard
bunx vitest run packages/dev-bubble/src/widget-state.test.ts --config vitest.config.ts
```

Required coverage goals for bubble logic:

- First tap selects/opens panel
- First tap on other bubble switches panel (no minimize)
- Second tap on selected+active bubble minimizes
- Minimize sets `collapsedPanel` to the triggering panel
- Closed state preserves `activePanel === selectedPanel === collapsedPanel`
- Expanded row excludes the collapsed panel identity

### Common modifications

**Change bubble size**: update `BUBBLE_SIZE` constant. All layout math derives from it.

**Change bubble color**: edit the `background: linear-gradient(...)` in `.db-btn` CSS.

**Change home button color**: edit the `background: linear-gradient(...)` in `.db-home` CSS.

**Change spacing**: update `BUBBLE_MARGIN`. All gaps (top, right, home-to-bubble, bubble-to-panel) use this single value.

**Change animation speed**: update `ANIM_DURATION` (bubble repositioning, panel slide), `HOME_SLIDE_DURATION` (home button reveal/hide), `HOME_REVEAL_DELAY` (how soon home button starts appearing after tap).

**Change edge-snap behavior**: modify `snapX()` function. Currently snaps to nearest horizontal edge.

**Change dock side behavior**: modify `sideForX()` and `dockedX(side)` to control whether maximize docks left/right or always to a fixed side.

**Remove focus rings/outlines**: ensure `:focus` and `:focus-visible` are explicitly styled on `.db-btn` and `.db-home` to prevent browser default white outlines after minimize.

**Add new buttons alongside bubble**: follow the home button pattern — fixed-position element whose `left`/`top` is computed relative to `pos`, with a CSS `transform` + `opacity` reveal transition and a state flag to control visibility.

### Key constraints

- **Widget is an IIFE bundle** — it must be self-contained. No external imports at runtime. React+ReactDOM are bundled inside.
- **Styles are in a template literal** (`WIDGET_CSS`) — not a separate CSS file. They're injected via a `<style>` tag at mount time.
- **All animations must be CSS transitions** — no JS `requestAnimationFrame` loops. CSS transitions are GPU-composited and won't jank.
- **Both bubble and panel are always mounted** — never conditionally render (`{isOpen && <Panel/>}`). This prevents iframe reload and DOM thrashing. Use CSS classes to show/hide.
- **The widget runs on every app page** — it must not conflict with the host app's styles. All classes are prefixed with `db-` or `ws-` to avoid collisions.

## Key Rules

1. **Never edit `/etc/nginx/sites-available/default` directly** — always use `deploy-nginx.sh`
2. **Always kill stale port processes before restarting** — Vite will silently pick a different port
3. **Use `strictPort: true`** in all Vite configs to fail loud instead of silently rebinding
4. **The dashboard reads `.env` live** — no restart needed for app list changes
5. **The DevBubble widget is injected by nginx** — `sub_filter` adds a `<script>` tag to every app page. The widget is a Messenger-style chat head (always-visible bubble, edge-snapping, side-aware top docking, opposite-side home button, panel anchored below bubble row). It's a self-contained React IIFE (React+ReactDOM bundled). To modify: edit `widget.tsx`, rebuild with esbuild, redeploy with `deploy-nginx.sh`, hard-refresh the app page. See the "Modifying the DevBubble Widget" playbook below.
6. **Dashboard is inside the workspace repo** at `~/workspace/dashboard/` — it is NOT a separate repository
7. **`APPS` in `.env` is the single source of truth** for what apps exist and how they're routed
8. **Always use SSH for git operations** — use `git@github.com:` URLs, not `https://github.com/`. HTTPS will fail because no credential helper is configured. If a repo already uses an HTTPS remote, switch it: `git remote set-url origin git@github.com:<owner>/<repo>.git`
9. **Support any web framework dynamically** — this workspace is not limited to Vite. Use the appropriate app type (`frontend`, `fullstack`, `nextjs`, `nuxt`, `laravel`, `backend`, `static`) based on the user's tech stack. If a framework isn't explicitly listed, use `backend` for server-rendered apps or `static` for any other dev server. Always configure the framework's base path to match the slug and bind to `0.0.0.0`.
