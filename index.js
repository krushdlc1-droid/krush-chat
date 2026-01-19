import WebSocket, { WebSocketServer } from "ws";
import fs from "fs";
import crypto from "crypto";

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

/* ================= CONFIG ================= */
const MESSAGE_COOLDOWN = 3000; // 3 секунды
const ADMINS = ["HZeed", "Silv4ik", "Raze"];

/* ================= LOG ================= */
function log(text) {
  const line = `[${new Date().toISOString()}] ${text}\n`;
  console.log(text);
  fs.appendFileSync("server.log", line);
}

log("IRC server started");

/* ================= XOR ================= */
function cypher(input) {
  const buf = Buffer.from(input, "utf8");
  for (let i = 0; i < buf.length; i++) buf[i] ^= 0x15;
  return buf.toString("utf8");
}

/* ================= STORAGE ================= */
const prefixes = new Map();        // clientId -> prefix
const users = new Map();           // clientId -> username
const lastMessage = new Map();     // username -> timestamp
const mutes = new Map();           // username -> unmute time

/* ================= FILTER ================= */
const banned = [
  "маму твою ебал",
  "ебал твою мать",
  "мать ебал",
  "маму ебал",
  "мать твою"
];

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9\s]/gi, "");
}

function hasMotherInsult(text) {
  const n = normalize(text);
  return banned.some(p => n.includes(p));
}

/* ================= CAPS ================= */
function antiCaps(text) {
  const upper = text.replace(/[^A-ZА-Я]/g, "").length;
  if (upper >= text.length * 0.6) {
    return text.toLowerCase();
  }
  return text;
}

/* ================= WS ================= */
wss.on("connection", (ws, req) => {
  const clientId = req.headers["sec-websocket-key"] || crypto.randomUUID();
  log(`CONNECT ${clientId}`);

  ws.on("message", raw => {
    try {
      const data = JSON.parse(cypher(raw.toString()));

      if (data.author) {
        users.set(clientId, data.author);
      }

      /* ===== TEXT ===== */
      if (data.type === "text") {
        const author = data.author;
        let msg = data.message;

        /* ===== COOLDOWN ===== */
        const last = lastMessage.get(author) || 0;
        const now = Date.now();

        if (now - last < MESSAGE_COOLDOWN) {
          ws.send(cypher(JSON.stringify({
            type: "system",
            message: "Подождите 3 секунды перед следующим сообщением"
          })));
          return;
        }

        lastMessage.set(author, now);

        /* ===== CAPS ===== */
        msg = antiCaps(msg);

        /* ===== FILTER ===== */
        if (hasMotherInsult(msg)) {
          log(`FILTER mother insult from ${author}`);
          ws.send(cypher(JSON.stringify({
            type: "system",
            message: "Запрещены оскорбления про мать"
          })));
          return;
        }

        /* ===== SEND ===== */
        const outgoing = {
          id: crypto.randomUUID(),
          type: "text",
          author,
          message: msg,
          prefix: prefixes.get(data.clientId) || ""
        };

        wss.clients.forEach(c => {
          if (c.readyState === WebSocket.OPEN) {
            c.send(cypher(JSON.stringify(outgoing)));
          }
        });

        log(`MSG ${author}: ${msg}`);
      }

    } catch (e) {
      log(`ERROR ${e.message}`);
    }
  });

  ws.on("close", () => {
    log(`DISCONNECT ${clientId}`);
  });
});
