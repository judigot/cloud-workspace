"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
var hono_1 = require("hono");
var cors_1 = require("hono/cors");
var node_fs_1 = require("node:fs");
var promises_1 = require("node:fs/promises");
var node_net_1 = require("node:net");
var node_path_1 = require("node:path");
var node_crypto_1 = require("node:crypto");
var WORKSPACE_ENV = process.env.WORKSPACE_ENV_PATH || "/home/ubuntu/workspace/.env";
var WORKSPACE_UPLOAD_ROOT = process.env.WORKSPACE_UPLOAD_ROOT || "/home/ubuntu/workspace/uploads";
function parseEnv() {
    var defaults = {
        domain: "judigot.com",
        opencodeDomain: "dev.judigot.com",
        apps: [],
    };
    try {
        var content = (0, node_fs_1.readFileSync)(WORKSPACE_ENV, "utf-8");
        var vars = {};
        for (var _i = 0, _a = content.split("\n"); _i < _a.length; _i++) {
            var line = _a[_i];
            var trimmed = line.trim();
            if (trimmed === "" || trimmed.startsWith("#")) {
                continue;
            }
            var eqIdx = trimmed.indexOf("=");
            if (eqIdx === -1) {
                continue;
            }
            var key = trimmed.slice(0, eqIdx);
            var value = trimmed.slice(eqIdx + 1);
            /* Strip surrounding quotes */
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            vars[key] = value;
        }
        var domain = vars["DOMAIN"] || defaults.domain;
        var opencodeDomain = vars["OPENCODE_SUBDOMAIN"] || "dev.".concat(domain);
        var appsEnv = vars["APPS"] || "";
        var viteApps = vars["VITE_APPS"] || "";
        var apps = void 0;
        if (appsEnv.trim()) {
            /* New format: slug:type:frontend_port[:backend_port[:options]] */
            apps = appsEnv
                .trim()
                .split(/\s+/)
                .filter(function (entry) { return entry.includes(":"); })
                .map(function (entry) {
                var parts = entry.split(":");
                var slug = parts[0];
                var type = (parts[1] || "frontend");
                var frontendPort = parts[2] ? Number(parts[2]) : null;
                var backendPort = parts[3] ? Number(parts[3]) : null;
                var options = parts[4] ? parts[4].split(",") : [];
                return { slug: slug, type: type, frontendPort: frontendPort, backendPort: backendPort, options: options };
            });
        }
        else if (viteApps.trim()) {
            /* Legacy format: slug:port */
            apps = viteApps
                .trim()
                .split(/\s+/)
                .filter(function (entry) { return entry.includes(":"); })
                .map(function (entry) {
                var _a = entry.split(":"), slug = _a[0], portStr = _a[1];
                return {
                    slug: slug,
                    type: "frontend",
                    frontendPort: Number(portStr),
                    backendPort: null,
                    options: [],
                };
            });
        }
        else {
            apps = [];
        }
        return { domain: domain, opencodeDomain: opencodeDomain, apps: apps };
    }
    catch (_b) {
        return defaults;
    }
}
function checkPort(port, host) {
    if (host === void 0) { host = "127.0.0.1"; }
    return new Promise(function (resolve) {
        var socket = (0, node_net_1.createConnection)({ port: port, host: host, timeout: 500 });
        socket.on("connect", function () {
            socket.destroy();
            resolve(true);
        });
        socket.on("error", function () {
            resolve(false);
        });
        socket.on("timeout", function () {
            socket.destroy();
            resolve(false);
        });
    });
}
function makeFallbackLabel(slug) {
    var _a;
    var parts = slug.split("-").filter(Boolean);
    if (parts.length === 0)
        return "?";
    if (parts.length === 1) {
        var part = parts[0];
        var match = part.match(/^([a-z]+)(\d+)$/i);
        if (match)
            return "".concat(((_a = match[1][0]) === null || _a === void 0 ? void 0 : _a.toUpperCase()) || "A").concat(match[2]);
        return part.slice(0, 2).toUpperCase();
    }
    var first = parts[0][0] || "A";
    var second = parts[1].match(/^\d+$/) ? parts[1] : (parts[1][0] || "A");
    return "".concat(first).concat(second).toUpperCase();
}
function humanizeSlug(slug) {
    return slug
        .split("-")
        .filter(Boolean)
        .map(function (part) { return (/^\d+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)); })
        .join(" ") || slug;
}
function makeFallbackHue(slug) {
    var hash = 0;
    for (var _i = 0, slug_1 = slug; _i < slug_1.length; _i++) {
        var char = slug_1[_i];
        hash = (hash * 31 + char.charCodeAt(0)) % 360;
    }
    return hash;
}
function discoverAppRoots() {
    return __awaiter(this, void 0, void 0, function () {
        var homeRoot, entries, slugToRoot;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    homeRoot = "/home/ubuntu";
                    return [4 /*yield*/, (0, promises_1.readdir)(homeRoot, { withFileTypes: true })];
                case 1:
                    entries = _a.sent();
                    slugToRoot = new Map();
                    return [4 /*yield*/, Promise.all(entries
                            .filter(function (entry) { return entry.isDirectory(); })
                            .map(function (entry) { return __awaiter(_this, void 0, void 0, function () {
                            var root, viteConfigPath, viteConfig, match, _a;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        root = node_path_1.default.join(homeRoot, entry.name);
                                        viteConfigPath = node_path_1.default.join(root, "vite.config.ts");
                                        _b.label = 1;
                                    case 1:
                                        _b.trys.push([1, 3, , 4]);
                                        return [4 /*yield*/, (0, promises_1.readFile)(viteConfigPath, "utf-8")];
                                    case 2:
                                        viteConfig = _b.sent();
                                        match = viteConfig.match(/VITE_BASE_PATH\s*\?\?\s*["']\/([^"']+)["']/);
                                        if (match === null || match === void 0 ? void 0 : match[1])
                                            slugToRoot.set(match[1], root);
                                        return [3 /*break*/, 4];
                                    case 3:
                                        _a = _b.sent();
                                        return [3 /*break*/, 4];
                                    case 4:
                                        if (/^[a-z0-9-]+$/.test(entry.name)) {
                                            slugToRoot.set(entry.name, root);
                                        }
                                        return [2 /*return*/];
                                }
                            });
                        }); }))];
                case 2:
                    _a.sent();
                    return [2 /*return*/, slugToRoot];
            }
        });
    });
}
function fileExists(filePath) {
    return __awaiter(this, void 0, void 0, function () {
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, (0, promises_1.stat)(filePath)];
                case 1:
                    _b.sent();
                    return [2 /*return*/, true];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, false];
                case 3: return [2 /*return*/];
            }
        });
    });
}
function resolveAppIconUrl(slug, roots) {
    return __awaiter(this, void 0, void 0, function () {
        var root, candidates, _i, candidates_1, fileName, diskPath;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    root = roots.get(slug);
                    if (!root)
                        return [2 /*return*/, null];
                    candidates = ["favicon.svg", "favicon.ico", "apple-touch-icon.png", "vite.svg"];
                    _i = 0, candidates_1 = candidates;
                    _a.label = 1;
                case 1:
                    if (!(_i < candidates_1.length)) return [3 /*break*/, 4];
                    fileName = candidates_1[_i];
                    diskPath = node_path_1.default.join(root, "public", fileName);
                    return [4 /*yield*/, fileExists(diskPath)];
                case 2:
                    if (_a.sent()) {
                        return [2 /*return*/, "/".concat(slug, "/").concat(fileName)];
                    }
                    _a.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4: return [2 /*return*/, null];
            }
        });
    });
}
function resolveAppTitle(slug, roots) {
    return __awaiter(this, void 0, void 0, function () {
        var root, htmlCandidates, _i, htmlCandidates_1, htmlPath, html, match, title, _a, packageJson, _b, _c, _d;
        var _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    root = roots.get(slug);
                    if (!root)
                        return [2 /*return*/, humanizeSlug(slug)];
                    htmlCandidates = [node_path_1.default.join(root, "index.html"), node_path_1.default.join(root, "public", "index.html")];
                    _i = 0, htmlCandidates_1 = htmlCandidates;
                    _f.label = 1;
                case 1:
                    if (!(_i < htmlCandidates_1.length)) return [3 /*break*/, 6];
                    htmlPath = htmlCandidates_1[_i];
                    _f.label = 2;
                case 2:
                    _f.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, (0, promises_1.readFile)(htmlPath, "utf-8")];
                case 3:
                    html = _f.sent();
                    match = html.match(/<title>([^<]+)<\/title>/i);
                    title = (_e = match === null || match === void 0 ? void 0 : match[1]) === null || _e === void 0 ? void 0 : _e.trim();
                    if (title)
                        return [2 /*return*/, title];
                    return [3 /*break*/, 5];
                case 4:
                    _a = _f.sent();
                    return [3 /*break*/, 5];
                case 5:
                    _i++;
                    return [3 /*break*/, 1];
                case 6:
                    _f.trys.push([6, 8, , 9]);
                    _c = (_b = JSON).parse;
                    return [4 /*yield*/, (0, promises_1.readFile)(node_path_1.default.join(root, "package.json"), "utf-8")];
                case 7:
                    packageJson = _c.apply(_b, [_f.sent()]);
                    if (packageJson.name)
                        return [2 /*return*/, humanizeSlug(packageJson.name)];
                    return [3 /*break*/, 9];
                case 8:
                    _d = _f.sent();
                    return [3 /*break*/, 9];
                case 9: return [2 /*return*/, humanizeSlug(slug)];
            }
        });
    });
}
function ensureUploadRoot() {
    (0, node_fs_1.mkdirSync)(WORKSPACE_UPLOAD_ROOT, { recursive: true });
}
function mimeTypeFor(fileName) {
    var ext = node_path_1.default.extname(fileName).toLowerCase();
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
function listUploads() {
    return __awaiter(this, void 0, void 0, function () {
        var entries, files;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    ensureUploadRoot();
                    return [4 /*yield*/, (0, promises_1.readdir)(WORKSPACE_UPLOAD_ROOT, { withFileTypes: true })];
                case 1:
                    entries = _a.sent();
                    return [4 /*yield*/, Promise.all(entries
                            .filter(function (entry) { return entry.isFile(); })
                            .map(function (entry) { return __awaiter(_this, void 0, void 0, function () {
                            var serverPath, info;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        serverPath = node_path_1.default.join(WORKSPACE_UPLOAD_ROOT, entry.name);
                                        return [4 /*yield*/, (0, promises_1.stat)(serverPath)];
                                    case 1:
                                        info = _a.sent();
                                        return [2 /*return*/, {
                                                name: entry.name,
                                                mimeType: mimeTypeFor(entry.name),
                                                size: info.size,
                                                modifiedAt: info.mtime.toISOString(),
                                                serverPath: serverPath,
                                                url: "/api/uploads/file/".concat(encodeURIComponent(entry.name)),
                                            }];
                                }
                            });
                        }); }))];
                case 2:
                    files = _a.sent();
                    return [2 /*return*/, files.sort(function (a, b) { return Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt); })];
            }
        });
    });
}
function sanitizeBaseName(name) {
    return name
        .toLowerCase()
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "asset";
}
function extensionFor(file) {
    var explicit = node_path_1.default.extname(file.name).toLowerCase();
    if (explicit)
        return explicit;
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
function makeSavedName(file, content) {
    var hash = (0, node_crypto_1.createHash)("sha256").update(content).digest("hex").slice(0, 10);
    return "".concat(sanitizeBaseName(file.name), "-").concat(hash).concat(extensionFor(file));
}
exports.app = new hono_1.Hono();
exports.app.use("/*", (0, cors_1.cors)());
exports.app.get("/api/apps", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, domain, opencodeDomain, rawApps, appRoots, apps, config;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _a = parseEnv(), domain = _a.domain, opencodeDomain = _a.opencodeDomain, rawApps = _a.apps;
                return [4 /*yield*/, discoverAppRoots()];
            case 1:
                appRoots = _b.sent();
                return [4 /*yield*/, Promise.all(rawApps.map(function (raw) { return __awaiter(void 0, void 0, void 0, function () {
                        var status, frontendUp, _a;
                        var _b;
                        return __generator(this, function (_c) {
                            switch (_c.label) {
                                case 0:
                                    status = "unknown";
                                    if (!(raw.type === "laravel")) return [3 /*break*/, 4];
                                    if (!raw.backendPort) return [3 /*break*/, 2];
                                    return [4 /*yield*/, checkPort(raw.backendPort)];
                                case 1:
                                    status = (_c.sent()) ? "up" : "down";
                                    return [3 /*break*/, 3];
                                case 2:
                                    status = "down";
                                    _c.label = 3;
                                case 3: return [3 /*break*/, 11];
                                case 4:
                                    if (!(raw.type === "fullstack")) return [3 /*break*/, 8];
                                    if (!raw.frontendPort) return [3 /*break*/, 6];
                                    return [4 /*yield*/, checkPort(raw.frontendPort)];
                                case 5:
                                    _a = _c.sent();
                                    return [3 /*break*/, 7];
                                case 6:
                                    _a = false;
                                    _c.label = 7;
                                case 7:
                                    frontendUp = _a;
                                    status = frontendUp ? "up" : "down";
                                    return [3 /*break*/, 11];
                                case 8:
                                    if (!raw.frontendPort) return [3 /*break*/, 10];
                                    return [4 /*yield*/, checkPort(raw.frontendPort)];
                                case 9:
                                    status = (_c.sent()) ? "up" : "down";
                                    return [3 /*break*/, 11];
                                case 10:
                                    status = "down";
                                    _c.label = 11;
                                case 11:
                                    _b = {
                                        slug: raw.slug
                                    };
                                    return [4 /*yield*/, resolveAppTitle(raw.slug, appRoots)];
                                case 12:
                                    _b.title = _c.sent(),
                                        _b.type = raw.type,
                                        _b.frontendPort = raw.frontendPort,
                                        _b.backendPort = raw.backendPort,
                                        _b.options = raw.options,
                                        _b.url = "https://".concat(domain, "/").concat(raw.slug, "/"),
                                        _b.status = status;
                                    return [4 /*yield*/, resolveAppIconUrl(raw.slug, appRoots)];
                                case 13: return [2 /*return*/, (_b.iconUrl = _c.sent(),
                                        _b.fallbackLabel = makeFallbackLabel(raw.slug),
                                        _b.fallbackHue = makeFallbackHue(raw.slug),
                                        _b)];
                            }
                        });
                    }); }))];
            case 2:
                apps = _b.sent();
                config = { domain: domain, opencodeDomain: opencodeDomain, apps: apps };
                return [2 /*return*/, c.json(config)];
        }
    });
}); });
exports.app.get("/api/health", function (c) {
    return c.json({ status: "ok" });
});
exports.app.get("/api/uploads", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var assets;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, listUploads()];
            case 1:
                assets = _a.sent();
                return [2 /*return*/, c.json({ assets: assets })];
        }
    });
}); });
exports.app.get("/api/uploads/:name", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var assets, asset;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, listUploads()];
            case 1:
                assets = _a.sent();
                asset = assets.find(function (entry) { return entry.name === c.req.param("name"); });
                if (!asset) {
                    return [2 /*return*/, c.json({ error: "Upload not found." }, 404)];
                }
                return [2 /*return*/, c.json({ asset: asset })];
        }
    });
}); });
exports.app.get("/api/uploads/file/:savedName", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var savedName, assets, asset, filePath, fileBuffer, _a;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                savedName = node_path_1.default.basename(c.req.param("savedName"));
                return [4 /*yield*/, listUploads()];
            case 1:
                assets = _b.sent();
                asset = assets.find(function (entry) { return entry.name === savedName; });
                if (!asset) {
                    return [2 /*return*/, c.json({ error: "Upload not found." }, 404)];
                }
                _b.label = 2;
            case 2:
                _b.trys.push([2, 4, , 5]);
                filePath = node_path_1.default.join(WORKSPACE_UPLOAD_ROOT, savedName);
                return [4 /*yield*/, (0, promises_1.readFile)(filePath)];
            case 3:
                fileBuffer = _b.sent();
                return [2 /*return*/, new Response(fileBuffer, {
                        headers: {
                            "content-type": asset.mimeType || "application/octet-stream",
                            "cache-control": "public, max-age=31536000, immutable",
                        },
                    })];
            case 4:
                _a = _b.sent();
                return [2 /*return*/, c.json({ error: "Upload could not be read." }, 404)];
            case 5: return [2 /*return*/];
        }
    });
}); });
exports.app.post("/api/uploads", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var formData, files, uploaded, _i, files_1, file, content, _a, _b, savedName, serverPath, info, asset;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                ensureUploadRoot();
                return [4 /*yield*/, c.req.formData()];
            case 1:
                formData = _c.sent();
                files = formData
                    .getAll("files")
                    .filter(function (entry) { return entry instanceof File && entry.size > 0; });
                if (files.length === 0) {
                    return [2 /*return*/, c.json({ error: "No files were uploaded." }, 400)];
                }
                uploaded = [];
                _i = 0, files_1 = files;
                _c.label = 2;
            case 2:
                if (!(_i < files_1.length)) return [3 /*break*/, 7];
                file = files_1[_i];
                if (file.size > 20 * 1024 * 1024) {
                    return [2 /*return*/, c.json({ error: "".concat(file.name, " is larger than 20 MB.") }, 400)];
                }
                _b = (_a = Buffer).from;
                return [4 /*yield*/, file.arrayBuffer()];
            case 3:
                content = _b.apply(_a, [_c.sent()]);
                savedName = makeSavedName(file, content);
                serverPath = node_path_1.default.join(WORKSPACE_UPLOAD_ROOT, savedName);
                return [4 /*yield*/, (0, promises_1.writeFile)(serverPath, content)];
            case 4:
                _c.sent();
                return [4 /*yield*/, (0, promises_1.stat)(serverPath)];
            case 5:
                info = _c.sent();
                asset = {
                    name: savedName,
                    mimeType: file.type || mimeTypeFor(savedName),
                    size: info.size,
                    modifiedAt: info.mtime.toISOString(),
                    serverPath: serverPath,
                    url: "/api/uploads/file/".concat(encodeURIComponent(savedName)),
                };
                uploaded.push(asset);
                _c.label = 6;
            case 6:
                _i++;
                return [3 /*break*/, 2];
            case 7: return [2 /*return*/, c.json({ assets: uploaded }, 201)];
        }
    });
}); });
