import WebSocket, { WebSocketServer } from "ws";
import fs from "fs";
import crypto from "crypto";

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

const MESSAGE_COOLDOWN = 3000;

/* ===== LOG ===== */
function log(text) {
  const line = `[${new Date().toISOString()}] ${text}\n`;
  console.log(text);
  fs.appendFileSync("server.log", line);
}

/* ===== XOR ===== */
function cypher(input) {
  const buf = Buffer.from(input, "utf8");
  for (let i = 0; i < buf.length; i++) buf[i] ^= 0x15;
  return buf.toString("utf8");
}

/* ===== STORAGE ===== */
const prefixes = new Map();      // clientId -> prefix
const lastMessage = new Map();   // clientId -> timestamp

/* ===== CAPS ===== */
function antiCaps(text) {
  const upper = text.replace(/[^A-ZА-Я]/g, "").length;
  if (upper >= text.length * 0.6) return text.toLowerCase();
  return text;
}

/* ===== FILTER ===== */
const banned = ["маму твою ебал", "мать твою", "маму ебал"];

function normalize(text) {
  return text.toLowerCase().replace(/ё/g, "е");
}

function badMother(text) {
  const n = normalize(text);
  return banned.some(w => n.includes(w));
}

/* ===== WS ===== */
wss.on("connection", (ws, req) => {
  const clientId = req.headers["sec-websocket-key"] || crypto.randomUUID();
  log(`CONNECT ${clientId}`);

  ws.on("message", raw => {
    try {
      const data = JSON.parse(cypher(raw.toString()));

      /* ===== PREFIX ===== */
      if (data.type === "get_prefix") {
        ws.send(cypher(JSON.stringify({
          type: "prefix_info",
          prefix: prefixes.get(clientId) || ""
        })));
        return;
      }

      /* ===== TEXT ===== */
      if (data.type === "text") {
        const now = Date.now();
        const last = lastMessage.get(clientId) || 0;

        if (now - last < MESSAGE_COOLDOWN) {
          ws.send(cypher(JSON.stringify({
            type: "system",
            message: "⏳ Подождите 3 секунды перед следующим сообщением"
          })));
          return;
        }

        lastMessage.set(clientId, now);

        let msg = antiCaps(data.message || "");

        if (badMother(msg)) {
          ws.send(cypher(JSON.stringify({
            type: "system",
            message: "🚫 Оскорбления про мать запрещены"
          })));
          return;
        }

        const outgoing = {
          id: crypto.randomUUID(),
          type: "text",
          author: data.author || "unknown",
          message: msg,
          prefix: prefixes.get(clientId) || ""
        };

        wss.clients.forEach(c => {
          if (c.readyState === WebSocket.OPEN) {
            c.send(cypher(JSON.stringify(outgoing)));
          }
        });

        log(`MSG ${data.author}: ${msg}`);
      }

    } catch (e) {
      log("ERROR " + e.message);
    }
  });

  ws.on("close", () => {
    log(`DISCONNECT ${clientId}`);
  });
});
