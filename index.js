import WebSocket, { WebSocketServer } from "ws";
import fs from "fs";

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

// ===== LOG FILE =====
function log(text) {
  const line = `[${new Date().toISOString()}] ${text}\n`;
  console.log(text);
  fs.appendFileSync("server.log", line);
}

log("WebSocket IRC server started");

// ===== XOR =====
function cypher(input) {
  const buf = Buffer.from(input, "utf8");
  for (let i = 0; i < buf.length; i++) buf[i] ^= 0x15;
  return buf.toString("utf8");
}

// ===== STORAGE =====
const prefixes = new Map();
const capsWarnings = new Map(); // clientId -> count
const muted = new Map(); // clientId -> timeoutId

// ===== FILTER MOTHER =====
const bannedPhrases = [
  "маму твою ебал",
  "ебал твою мать",
  "мать ебал",
  "маму ебал",
  "мать твою",
  "мама шлюха"
];

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9\s]/gi, "");
}

function containsMotherInsult(text) {
  const norm = normalize(text);
  return bannedPhrases.some(p => norm.includes(p));
}

// ===== CAPS CHECK =====
function isCapsMessage(text) {
  const letters = text.replace(/[^a-zа-я]/gi, "");
  if (letters.length < 6) return false;

  const upper = letters.replace(/[^A-ZА-Я]/g, "").length;
  return upper / letters.length >= 0.7;
}

// ===== AUTO UNMUTE =====
function muteClient(clientId, ws) {
  if (muted.has(clientId)) return;

  log(`[MUTE] ${clientId} for 10 minutes`);

  ws.send(cypher(JSON.stringify({
    type: "mute",
    reason: "Капс",
    duration_minutes: 10
  })));

  const timeout = setTimeout(() => {
    muted.delete(clientId);
    capsWarnings.set(clientId, 0);

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(cypher(JSON.stringify({
        type: "unmute"
      })));
    }

    log(`[UNMUTE] ${clientId}`);
  }, 10 * 60 * 1000); // 10 минут

  muted.set(clientId, timeout);
}

wss.on("connection", (ws, req) => {
  const clientId = req.headers["sec-websocket-key"] || "unknown";
  log(`[CONNECT] ${clientId}`);

  ws.on("message", raw => {
    try {
      const decoded = cypher(raw.toString());
      const data = JSON.parse(decoded);

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
        ws.send(cypher(JSON.stringify({
          type: "prefix_updated",
          prefix: data.new_prefix || ""
        })));
        return;
      }

      // ===== TEXT =====
      if (data.type === "text") {

        if (muted.has(clientId)) return;

        // length limit
        if (data.message.length > 120) {
          ws.send(cypher(JSON.stringify({
            type: "system",
            message: "Максимум 120 символов"
          })));
          return;
        }

        // mother filter
        if (containsMotherInsult(data.message)) {
          log(`[FILTER] mother insult from ${clientId}`);
          ws.send(cypher(JSON.stringify({
            type: "system",
            message: "Запрещены оскорбления про мать"
          })));
          return;
        }

        // CAPS
        if (isCapsMessage(data.message)) {
          const count = (capsWarnings.get(clientId) || 0) + 1;
          capsWarnings.set(clientId, count);

          log(`[CAPS] ${clientId} warning ${count}/3`);

          if (count >= 3) {
            muteClient(clientId, ws);
            return;
          }

          ws.send(cypher(JSON.stringify({
            type: "system",
            message: `Капс запрещён. Предупреждение ${count}/3`
          })));
          return;
        }

        // SEND
        const outgoing = {
          type: "text",
          author: data.author || "unknown",
          message: data.message || "",
          prefix: prefixes.get(data.clientId) || ""
        };

        wss.clients.forEach(c => {
          if (c.readyState === WebSocket.OPEN) {
            c.send(cypher(JSON.stringify(outgoing)));
          }
        });
      }

    } catch (e) {
      log(`[ERROR] ${e.message}`);
    }
  });

  ws.on("close", () => {
    log(`[DISCONNECT] ${clientId}`);
    if (muted.has(clientId)) {
      clearTimeout(muted.get(clientId));
      muted.delete(clientId);
    }
  });
});
