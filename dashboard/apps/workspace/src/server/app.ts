import { Hono } from "hono";
import { cors } from "hono/cors";
import { mkdirSync, readFileSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import path from "node:path";
import { createHash } from "node:crypto";

const WORKSPACE_ENV =
  process.env.WORKSPACE_ENV_PATH || "/home/ubuntu/workspace/.env";
const WORKSPACE_UPLOAD_ROOT =
  process.env.WORKSPACE_UPLOAD_ROOT || "/home/ubuntu/workspace/uploads";

interface IUploadAsset {
  name: string;
  mimeType: string;
  size: number;
  modifiedAt: string;
  serverPath: string;
  url: string;
}

interface IApp {
  slug: string;
  type: "frontend" | "fullstack" | "laravel";
  frontendPort: number | null;
  backendPort: number | null;
  options: string[];
  url: string;
  status: "up" | "down" | "unknown";
  iconUrl: string | null;
  fallbackLabel: string;
  fallbackHue: number;
}

interface IConfig {
  domain: string;
  opencodeDomain: string;
  apps: IApp[];
}

interface IRawApp {
  slug: string;
  type: "frontend" | "fullstack" | "laravel";
  frontendPort: number | null;
  backendPort: number | null;
  options: string[];
}

function parseEnv(): { domain: string; opencodeDomain: string; apps: IRawApp[] } {
  const defaults = {
    domain: "judigot.com",
    opencodeDomain: "opencode.judigot.com",
    apps: [] as IRawApp[],
  };

  try {
    const content = readFileSync(WORKSPACE_ENV, "utf-8");
    const vars: Record<string, string> = {};

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) {
        continue;
      }
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) {
        continue;
      }
      const key = trimmed.slice(0, eqIdx);
      let value = trimmed.slice(eqIdx + 1);
      /* Strip surrounding quotes */
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }

    const domain = vars["DOMAIN"] || defaults.domain;
    const opencodeDomain =
      vars["OPENCODE_SUBDOMAIN"] || `opencode.${domain}`;

    const appsEnv = vars["APPS"] || "";
    const viteApps = vars["VITE_APPS"] || "";

    let apps: IRawApp[];

    if (appsEnv.trim()) {
      /* New format: slug:type:frontend_port[:backend_port[:options]] */
      apps = appsEnv
        .trim()
        .split(/\s+/)
        .filter((entry) => entry.includes(":"))
        .map((entry) => {
          const parts = entry.split(":");
          const slug = parts[0];
          const type = (parts[1] || "frontend") as IRawApp["type"];
          const frontendPort = parts[2] ? Number(parts[2]) : null;
          const backendPort = parts[3] ? Number(parts[3]) : null;
          const options = parts[4] ? parts[4].split(",") : [];
          return { slug, type, frontendPort, backendPort, options };
        });
    } else if (viteApps.trim()) {
      /* Legacy format: slug:port */
      apps = viteApps
        .trim()
        .split(/\s+/)
        .filter((entry) => entry.includes(":"))
        .map((entry) => {
          const [slug, portStr] = entry.split(":");
          return {
            slug,
            type: "frontend" as const,
            frontendPort: Number(portStr),
            backendPort: null,
            options: [],
          };
        });
    } else {
      apps = [];
    }

    return { domain, opencodeDomain, apps };
  } catch {
    return defaults;
  }
}

function checkPort(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host, timeout: 500 });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      resolve(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function makeFallbackLabel(slug: string) {
  const parts = slug.split("-").filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    const part = parts[0];
    const match = part.match(/^([a-z]+)(\d+)$/i);
    if (match) return `${match[1][0]?.toUpperCase() || "A"}${match[2]}`;
    return part.slice(0, 2).toUpperCase();
  }
  const first = parts[0][0] || "A";
  const second = parts[1].match(/^\d+$/) ? parts[1] : (parts[1][0] || "A");
  return `${first}${second}`.toUpperCase();
}

function makeFallbackHue(slug: string) {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

async function discoverAppRoots() {
  const homeRoot = "/home/ubuntu";
  const entries = await readdir(homeRoot, { withFileTypes: true });
  const slugToRoot = new Map<string, string>();

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const root = path.join(homeRoot, entry.name);
        const viteConfigPath = path.join(root, "vite.config.ts");

        try {
          const viteConfig = await readFile(viteConfigPath, "utf-8");
          const match = viteConfig.match(/VITE_BASE_PATH\s*\?\?\s*["']\/([^"']+)["']/);
          if (match?.[1]) slugToRoot.set(match[1], root);
        } catch {
          // ignore non-vite apps
        }

        if (/^[a-z0-9-]+$/.test(entry.name)) {
          slugToRoot.set(entry.name, root);
        }
      }),
  );

  return slugToRoot;
}

async function fileExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveAppIconUrl(slug: string, roots: Map<string, string>) {
  const root = roots.get(slug);
  if (!root) return null;

  const candidates = ["favicon.svg", "favicon.ico", "apple-touch-icon.png", "vite.svg"];
  for (const fileName of candidates) {
    const diskPath = path.join(root, "public", fileName);
    if (await fileExists(diskPath)) {
      return `/${slug}/${fileName}`;
    }
  }

  return null;
}

function ensureUploadRoot() {
  mkdirSync(WORKSPACE_UPLOAD_ROOT, { recursive: true });
}

function mimeTypeFor(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".pdf":
      return "application/pdf";
    case ".json":
      return "application/json";
    case ".txt":
    case ".md":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

async function listUploads(): Promise<IUploadAsset[]> {
  ensureUploadRoot();
  const entries = await readdir(WORKSPACE_UPLOAD_ROOT, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const serverPath = path.join(WORKSPACE_UPLOAD_ROOT, entry.name);
        const info = await stat(serverPath);
        return {
          name: entry.name,
          mimeType: mimeTypeFor(entry.name),
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
          serverPath,
          url: `/api/uploads/file/${encodeURIComponent(entry.name)}`,
        } satisfies IUploadAsset;
      }),
  );

  return files.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
}

function sanitizeBaseName(name: string) {
  return name
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "asset";
}

function extensionFor(file: File) {
  const explicit = path.extname(file.name).toLowerCase();
  if (explicit) return explicit;
  switch (file.type) {
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return ".jpg";
  }
}

function makeSavedName(file: File, content: Buffer) {
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 10);
  return `${sanitizeBaseName(file.name)}-${hash}${extensionFor(file)}`;
}

export const app = new Hono();

app.use("/*", cors());

app.get("/api/apps", async (c) => {
  const { domain, opencodeDomain, apps: rawApps } = parseEnv();
  const appRoots = await discoverAppRoots();

  const apps: IApp[] = await Promise.all(
    rawApps.map(async (raw) => {
      let status: IApp["status"] = "unknown";

      if (raw.type === "laravel") {
        /* Laravel: check backend port */
        if (raw.backendPort) {
          status = (await checkPort(raw.backendPort)) ? "up" : "down";
        } else {
          status = "down";
        }
      } else if (raw.type === "fullstack") {
        /* Fullstack: check both, but frontend is the primary indicator */
        const frontendUp = raw.frontendPort
          ? await checkPort(raw.frontendPort)
          : false;
        status = frontendUp ? "up" : "down";
      } else {
        /* Frontend: check frontend port */
        if (raw.frontendPort) {
          status = (await checkPort(raw.frontendPort)) ? "up" : "down";
        } else {
          status = "down";
        }
      }

      return {
        slug: raw.slug,
        type: raw.type,
        frontendPort: raw.frontendPort,
        backendPort: raw.backendPort,
        options: raw.options,
        url: `https://${domain}/${raw.slug}/`,
        status,
        iconUrl: await resolveAppIconUrl(raw.slug, appRoots),
        fallbackLabel: makeFallbackLabel(raw.slug),
        fallbackHue: makeFallbackHue(raw.slug),
      };
    }),
  );

  const config: IConfig = { domain, opencodeDomain, apps };
  return c.json(config);
});

app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

app.get("/api/uploads", async (c) => {
  const assets = await listUploads();
  return c.json({ assets });
});

app.get("/api/uploads/:name", async (c) => {
  const assets = await listUploads();
  const asset = assets.find((entry) => entry.name === c.req.param("name"));
  if (!asset) {
    return c.json({ error: "Upload not found." }, 404);
  }
  return c.json({ asset });
});

app.get("/api/uploads/file/:savedName", async (c) => {
  const savedName = path.basename(c.req.param("savedName"));
  const assets = await listUploads();
  const asset = assets.find((entry) => entry.name === savedName);
  if (!asset) {
    return c.json({ error: "Upload not found." }, 404);
  }

  try {
    const filePath = path.join(WORKSPACE_UPLOAD_ROOT, savedName);
    const fileBuffer = await readFile(filePath);
    return new Response(fileBuffer, {
      headers: {
        "content-type": asset.mimeType || "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return c.json({ error: "Upload could not be read." }, 404);
  }
});

app.post("/api/uploads", async (c) => {
  ensureUploadRoot();
  const formData = await c.req.formData();
  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (files.length === 0) {
    return c.json({ error: "No files were uploaded." }, 400);
  }

  const uploaded: IUploadAsset[] = [];

  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) {
      return c.json({ error: `${file.name} is larger than 20 MB.` }, 400);
    }

    const content = Buffer.from(await file.arrayBuffer());
    const savedName = makeSavedName(file, content);
    const serverPath = path.join(WORKSPACE_UPLOAD_ROOT, savedName);
    await writeFile(serverPath, content);
    const info = await stat(serverPath);
    const asset: IUploadAsset = {
      name: savedName,
      mimeType: file.type || mimeTypeFor(savedName),
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      serverPath,
      url: `/api/uploads/file/${encodeURIComponent(savedName)}`,
    };
    uploaded.push(asset);
  }

  return c.json({ assets: uploaded }, 201);
});
