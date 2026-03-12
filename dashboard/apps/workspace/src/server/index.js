"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var node_server_1 = require("@hono/node-server");
var node_ws_1 = require("@hono/node-ws");
var app_js_1 = require("./app.js");
var terminal_js_1 = require("./terminal.js");
var PORT = Number(process.env.DASHBOARD_API_PORT) || 3100;
var _a = (0, node_ws_1.createNodeWebSocket)({ app: app_js_1.app }), injectWebSocket = _a.injectWebSocket, upgradeWebSocket = _a.upgradeWebSocket;
(0, terminal_js_1.registerTerminalWebSocketRoute)(app_js_1.app, upgradeWebSocket);
var server = (0, node_server_1.serve)({ fetch: app_js_1.app.fetch, port: PORT }, function (info) {
    console.error("Dashboard API running on http://localhost:".concat(String(info.port)));
});
injectWebSocket(server);
