"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTerminalWebSocketRoute = registerTerminalWebSocketRoute;
var pty = require("node-pty");
var node_fs_1 = require("node:fs");
var DEFAULT_TERMINAL_COLS = 120;
var DEFAULT_TERMINAL_ROWS = 36;
function getShellCommand() {
    if (process.platform === "win32")
        return "powershell.exe";
    return process.env.SHELL || "bash";
}
function getShellLaunch(shell) {
    if (shell.includes("zsh")) {
        return {
            shell: shell,
            args: ["-f", "-i"],
            env: { PS1: "%# ", PROMPT: "%# " },
        };
    }
    if (shell.includes("bash")) {
        return {
            shell: shell,
            args: ["--noprofile", "--norc", "-i"],
            env: { PS1: "$ ", PROMPT_COMMAND: "" },
        };
    }
    return {
        shell: shell,
        args: ["-i"],
        env: { PS1: "$ " },
    };
}
function formatCwdLabel(cwd, workspaceRoot) {
    if (cwd === workspaceRoot)
        return "~";
    if (cwd.startsWith("".concat(workspaceRoot, "/"))) {
        return "~/".concat(cwd.slice(workspaceRoot.length + 1));
    }
    var home = process.env.HOME;
    if (home) {
        if (cwd === home)
            return "~";
        if (cwd.startsWith("".concat(home, "/")))
            return "~/".concat(cwd.slice(home.length + 1));
    }
    return cwd;
}
function emitCwd(ws, ptyProcess, workspaceRoot) {
    try {
        var cwd = (0, node_fs_1.readlinkSync)("/proc/".concat(String(ptyProcess.pid), "/cwd"));
        ws.send(JSON.stringify({
            type: "cwd",
            path: formatCwdLabel(cwd, workspaceRoot),
        }));
    }
    catch (_a) {
        // no-op
    }
}
function parseClientMessage(raw) {
    try {
        var parsed = JSON.parse(raw);
        if (parsed.type === "input" && typeof parsed.data === "string") {
            return { type: "input", data: parsed.data };
        }
        if (parsed.type === "resize" &&
            typeof parsed.cols === "number" &&
            typeof parsed.rows === "number") {
            return { type: "resize", cols: parsed.cols, rows: parsed.rows };
        }
        if (parsed.type === "ping") {
            return { type: "ping" };
        }
        return null;
    }
    catch (_a) {
        return null;
    }
}
function registerTerminalWebSocketRoute(app, upgradeWebSocket) {
    app.get("/api/terminal/ws", upgradeWebSocket(function () {
        var ptyProcess = null;
        var isClosed = false;
        var cwdTimer = null;
        var workspaceRoot = process.env.WORKSPACE_ROOT || "/home/ubuntu/workspace";
        var cleanup = function () {
            if (isClosed)
                return;
            isClosed = true;
            if (cwdTimer) {
                clearTimeout(cwdTimer);
                cwdTimer = null;
            }
            if (ptyProcess) {
                try {
                    ptyProcess.kill();
                }
                catch (_a) {
                    // no-op
                }
                ptyProcess = null;
            }
        };
        return {
            onOpen: function (_event, ws) {
                var shell = getShellCommand();
                var launch = getShellLaunch(shell);
                workspaceRoot = process.env.WORKSPACE_ROOT || "/home/ubuntu/workspace";
                ptyProcess = pty.spawn(launch.shell, launch.args, {
                    name: "xterm-256color",
                    cols: DEFAULT_TERMINAL_COLS,
                    rows: DEFAULT_TERMINAL_ROWS,
                    cwd: workspaceRoot,
                    env: __assign(__assign(__assign({}, process.env), { TERM: "xterm-256color" }), launch.env),
                    handleFlowControl: true,
                });
                emitCwd(ws, ptyProcess, workspaceRoot);
                ptyProcess.onData(function (chunk) {
                    try {
                        ws.send(JSON.stringify({ type: "output", data: chunk }));
                    }
                    catch (_a) {
                        cleanup();
                    }
                });
                ptyProcess.onExit(function (_a) {
                    var exitCode = _a.exitCode;
                    try {
                        ws.send(JSON.stringify({
                            type: "exit",
                            code: exitCode,
                        }));
                        ws.close(1000, "Terminal process exited");
                    }
                    catch (_b) {
                        // no-op
                    }
                    finally {
                        cleanup();
                    }
                });
            },
            onMessage: function (event, ws) {
                if (!ptyProcess || isClosed)
                    return;
                if (typeof event.data !== "string")
                    return;
                var message = parseClientMessage(event.data);
                if (!message) {
                    ptyProcess.write(event.data);
                    return;
                }
                if (message.type === "input") {
                    ptyProcess.write(message.data);
                    // Emit updated cwd after command submit (enter/newline).
                    if (message.data.includes("\r") || message.data.includes("\n")) {
                        if (cwdTimer)
                            clearTimeout(cwdTimer);
                        cwdTimer = setTimeout(function () {
                            cwdTimer = null;
                            if (!ptyProcess || isClosed)
                                return;
                            emitCwd(ws, ptyProcess, workspaceRoot);
                        }, 140);
                    }
                    return;
                }
                if (message.type === "resize") {
                    var cols = Math.max(20, Math.floor(message.cols));
                    var rows = Math.max(8, Math.floor(message.rows));
                    ptyProcess.resize(cols, rows);
                    return;
                }
                if (message.type === "ping") {
                    ws.send(JSON.stringify({ type: "pong" }));
                }
            },
            onClose: function () {
                cleanup();
            },
            onError: function () {
                cleanup();
            },
        };
    }));
}
