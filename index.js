import WebSocket, { WebSocketServer } from "ws";
import fs from "fs";

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

console.log("WebSocket IRC server started");

// ================= НАСТРОЙКИ =================
const MESSAGE_COOLDOWN = 3000; // 3 сек
const MAX_MESSAGE_LENGTH = 200;

// clientId -> prefix
const prefixes = new Map();

// clientId -> lastMessageTime
const lastMessageTime = new Map();

// ============================================

// XOR (как в Java)
function cypher(input) {
  const buf = Buffer.from(input, "utf8");
  for (let i = 0; i < buf.length; i++) {
    buf[i] = buf[i] ^ 0x15;
  }
  return buf.toString("utf8");
}

// Антикапс: если >70% букв — капс → в lowerCase
function normalizeCaps(text) {
  const letters = text.replace(/[^a-zA-Zа-яА-Я]/g, "");
  if (!letters.length) return text;

  const upper = letters.replace(/[^A-ZА-Я]/g, "").length;
  const percent = upper / letters.length;

  return percent > 0.7 ? text.toLowerCase() : text;
}

wss.on("connection", (ws, req) => {
  const clientId = req.headers["sec-websocket-key"] || "unknown";
  console.log("Client connected:", clientId);

  ws.on("message", (raw) => {
    try {
      const decoded = cypher(raw.toString());
      const data = JSON.parse(decoded);

      // ===== GET PREFIX =====
      if (data.type === "get_prefix") {
        ws.send(
          cypher(
            JSON.stringify({
              type: "prefix_info",
              prefix: prefixes.get(data.clientId) || "",
            })
          )
        );
        return;
      }

      // ===== SET PREFIX =====
      if (data.type === "set_prefix") {
        prefixes.set(data.clientId, data.new_prefix || "");
        ws.send(
          cypher(
            JSON.stringify({
              type: "prefix_updated",
              prefix: data.new_prefix || "",
            })
          )
        );
        return;
      }

      // ===== TEXT =====
      if (data.type === "text") {
        const now = Date.now();
        const last = lastMessageTime.get(data.clientId) || 0;

        // ⏳ КД 3 сек с таймером
        if (now - last < MESSAGE_COOLDOWN) {
          const remainMs = MESSAGE_COOLDOWN - (now - last);
          const remainSec = Math.ceil(remainMs / 1000);

          ws.send(
            cypher(
              JSON.stringify({
                type: "system",
                message: `⏳ Подождите ещё ${remainSec} сек`,
              })
            )
          );
          return;
        }

        lastMessageTime.set(data.clientId, now);

        let message = data.message || "";

        // 📏 лимит длины
        if (message.length > MAX_MESSAGE_LENGTH) {
          ws.send(
            cypher(
              JSON.stringify({
                type: "system",
                message: `❌ Сообщение слишком длинное (макс ${MAX_MESSAGE_LENGTH})`,
              })
            )
          );
          return;
        }

        // 🔤 антикапс
        message = normalizeCaps(message);

        const outgoing = {
          type: "text",
          id: `${data.clientId}_${now}`, // защита от дублей
          author: data.author || "unknown",
          message,
          prefix: prefixes.get(data.clientId) || "",
        };

        wss.clients.forEach((c) => {
          if (c.readyState === WebSocket.OPEN) {
            c.send(cypher(JSON.stringify(outgoing)));
          }
        });
      }
    } catch (e) {
      console.log("Message error:", e.message);
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected:", clientId);
  });
});

console.log("Listening on port", PORT);
