import WebSocket, { WebSocketServer } from "ws";
import fs from "fs";
import crypto from "crypto";

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

/* ================= ADMIN ================= */
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
const prefixes = new Map();      // clientId -> prefix
const users = new Map();         // clientId -> { ws, username }
const mutes = new Map();         // username -> unmuteTimestamp

/* ================= FILTER ================= */
const banned = [
  "маму твою ебал",
  "ебал твою мать",
  "мать ебал",
  "маму ебал",
  "мать твою"
];

function normalize(text) {
  return text.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9\s]/gi, "");
}
function hasMotherInsult(text) {
  const n = normalize(text);
  return banned.some(p => n.includes(p));
}

/* ================= WS ================= */
wss.on("connection", (ws, req) => {
  const clientId = req.headers["sec-websocket-key"] || crypto.randomUUID();
  log(`CONNECT ${clientId}`);

  ws.on("message", raw => {
    try {
      const data = JSON.parse(cypher(raw.toString()));

      /* ===== REGISTER USER ===== */
      if (data.author) {
        users.set(clientId, { ws, username: data.author });
      }

      /* ===== PREFIX ===== */
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

      /* ===== TEXT ===== */
      if (data.type === "text") {
        const author = data.author;
        const msg = data.message;

        /* ===== ADMIN COMMAND ===== */
        if (msg.startsWith("admin ")) {
          if (!ADMINS.includes(author)) {
            ws.send(cypher(JSON.stringify({
              type: "system",
              message: "У вас нет прав администратора"
            })));
            return;
          }

          const args = msg.split(" ");
          const action = args[1];

          /* MUTE */
          if (action === "mute") {
            const target = args[2];
            const minutes = parseInt(args[3]);

            if (!target || isNaN(minutes)) {
              ws.send(cypher(JSON.stringify({
                type: "system",
                message: "Использование: admin mute <ник> <минуты>"
              })));
              return;
            }

            const until = Date.now() + minutes * 60000;
            mutes.set(target, until);
            log(`MUTE ${target} ${minutes}m by ${author}`);

            broadcastSystem(`Игрок ${target} замучен на ${minutes} минут`);
            return;
          }

          /* UNMUTE */
          if (action === "unmute") {
            const target = args[2];
            mutes.delete(target);
            log(`UNMUTE ${target} by ${author}`);
            broadcastSystem(`Игрок ${target} размучен`);
            return;
          }
        }

        /* ===== CHECK MUTE ===== */
        if (mutes.has(author)) {
          if (Date.now() < mutes.get(author)) {
            ws.send(cypher(JSON.stringify({
              type: "system",
              message: "Вы замучены"
            })));
            return;
          } else {
            mutes.delete(author);
            ws.send(cypher(JSON.stringify({
              type: "system",
              message: "Вы автоматически размучены"
            })));
          }
        }

        /* ===== FILTER ===== */
        if (hasMotherInsult(msg)) {
          log(`FILTER mother ${author}`);
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
      }

    } catch (e) {
      log(`ERROR ${e.message}`);
    }
  });

  ws.on("close", () => {
    log(`DISCONNECT ${clientId}`);
  });
});

/* ================= HELPERS ================= */
function broadcastSystem(message) {
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) {
      c.send(cypher(JSON.stringify({
        type: "system",
        message
      })));
    }
  });
}
