import WebSocket, { WebSocketServer } from 'ws';
import fs from 'fs';

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

console.log("WebSocket IRC server started");

// ===== XOR как в Java =====
function cypher(input) {
  const buf = Buffer.from(input, 'utf8');
  for (let i = 0; i < buf.length; i++) {
    buf[i] ^= 0x15;
  }
  return buf.toString('utf8');
}

// ===== ХРАНИЛИЩА =====
const prefixes = new Map();          // clientId -> prefix
const lastMessageTime = new Map();   // clientId -> timestamp
const mutedUntil = new Map();        // clientId -> timestamp

// ===== ЛОГ =====
function log(text) {
  fs.appendFileSync("chat.log", text + "\n");
}

wss.on('connection', (ws, req) => {
  const clientId = req.headers['sec-websocket-key'] || Math.random().toString(36);
  console.log("Client connected:", clientId);

  ws.on('message', (raw) => {
    try {
      const decoded = cypher(raw.toString());
      const data = JSON.parse(decoded);

      const now = Date.now();

      // ===== MUTE =====
      const muteEnd = mutedUntil.get(clientId) || 0;
      if (muteEnd > now) {
        ws.send(cypher(JSON.stringify({
          type: "mute",
          reason: "Спам",
          duration_minutes: Math.ceil((muteEnd - now) / 60000)
        })));
        return;
      }

      // ===== ANTIFLOOD (800 мс) =====
      const last = lastMessageTime.get(clientId) || 0;
      if (now - last < 800) {
        mutedUntil.set(clientId, now + 5 * 60 * 1000); // мут 5 мин
        ws.send(cypher(JSON.stringify({
          type: "mute_attempt",
          reason: "Спам",
          duration_minutes: 5
        })));
        return;
      }
      lastMessageTime.set(clientId, now);

      // ===== PREFIX =====
      if (data.type === "get_prefix") {
        ws.send(cypher(JSON.stringify({
          type: "prefix_info",
          prefix: prefixes.get(clientId) || ""
        })));
        return;
      }

      if (data.type === "set_prefix") {
        prefixes.set(clientId, data.new_prefix || "");
        ws.send(cypher(JSON.stringify({
          type: "prefix_updated",
          prefix: data.new_prefix || ""
        })));
        return;
      }

      // ===== TEXT =====
      if (data.type === "text") {
        const msg = {
          type: "text",
          id: now + "_" + Math.random().toString(36).slice(2), // 🔥 ВАЖНО
          author: data.author || "unknown",
          message: data.message || "",
          prefix: prefixes.get(clientId) || ""
        };

        log(`[${msg.author}] ${msg.message}`);

        const encoded = cypher(JSON.stringify(msg));
        wss.clients.forEach(c => {
          if (c.readyState === WebSocket.OPEN) {
            c.send(encoded);
          }
        });
      }

    } catch (e) {
      console.log("Message error:", e.message);
    }
  });

  ws.on('close', () => {
    console.log("Client disconnected:", clientId);
  });
});
