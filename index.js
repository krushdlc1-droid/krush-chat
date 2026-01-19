import WebSocket, { WebSocketServer } from "ws";
import fs from "fs";

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

console.log("IRC server started");

function cypher(input) {
  const b = Buffer.from(input, "utf8");
  for (let i = 0; i < b.length; i++) b[i] ^= 0x15;
  return b.toString("utf8");
}

const prefixes = new Map();

function log(text) {
  fs.appendFileSync("irc.log", `[${new Date().toISOString()}] ${text}\n`);
}

wss.on("connection", (ws, req) => {
  const clientId = req.headers["sec-websocket-key"] || "unknown";
  console.log("Connected:", clientId);
  log("CONNECT " + clientId);

  ws.on("message", raw => {
    try {
      const data = JSON.parse(cypher(raw.toString()));

      // ===== PREFIX =====
      if (data.type === "get_prefix") {
        ws.send(cypher(JSON.stringify({
          type: "prefix_info",
          prefix: prefixes.get(data.clientId) || ""
        })));
        return;
      }

      if (data.type === "set_prefix") {
        prefixes.set(data.clientId, data.new_prefix || "");
        return;
      }

      // ===== TEXT =====
      if (data.type === "text") {

        // антикапс
        let msg = data.message;
        const upper = msg.replace(/[^A-ZА-Я]/g, "").length;
        if (upper / msg.length > 0.6) {
          msg = msg.toLowerCase();
        }

        const out = {
          id: Date.now() + Math.random().toString(36),
          type: "text",
          author: data.author,
          message: msg,
          prefix: prefixes.get(data.clientId) || ""
        };

        log(`${data.author}: ${msg}`);

        wss.clients.forEach(c => {
          if (c.readyState === WebSocket.OPEN) {
            c.send(cypher(JSON.stringify(out)));
          }
        });
      }

    } catch (e) {
      console.log("ERR:", e.message);
    }
  });

  ws.on("close", () => {
    log("DISCONNECT " + clientId);
  });
});
