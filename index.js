const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log("WebSocket IRC server started");

// XOR шифрование / дешифрование (как в Java)
function cypher(input) {
  const buf = Buffer.from(input, 'utf8');
  for (let i = 0; i < buf.length; i++) {
    buf[i] = buf[i] ^ 0x15;
  }
  return buf.toString('utf8');
}

// Храним префиксы по clientId
const prefixes = new Map();

wss.on('connection', (ws, req) => {
  const clientId = req.headers['sec-websocket-key'] || 'unknown';

  console.log("Client connected:", clientId);

  ws.on('message', (rawMessage) => {
    try {
      // 🔓 расшифровываем
      const decoded = cypher(rawMessage.toString());
      const data = JSON.parse(decoded);

      // ====== GET PREFIX ======
      if (data.type === "get_prefix") {
        const prefix = prefixes.get(data.clientId) || "";
        const response = {
          type: "prefix_info",
          prefix: prefix
        };
        ws.send(cypher(JSON.stringify(response)));
        return;
      }

      // ====== SET PREFIX ======
      if (data.type === "set_prefix") {
        prefixes.set(data.clientId, data.new_prefix || "");
        const response = {
          type: "prefix_updated",
          prefix: data.new_prefix || ""
        };

        // отправляем только этому клиенту
        ws.send(cypher(JSON.stringify(response)));
        return;
      }

      // ====== TEXT MESSAGE ======
      if (data.type === "text") {
        const prefix = prefixes.get(data.clientId) || "";

        const outgoing = {
          type: "text",
          author: data.author || "unknown",
          message: data.message || "",
          prefix: prefix
        };

        // 📢 рассылаем ВСЕМ
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(cypher(JSON.stringify(outgoing)));
          }
        });
        return;
      }

    } catch (e) {
      console.log("Message error:", e.message);
    }
  });

  ws.on('close', () => {
    console.log("Client disconnected:", clientId);
  });

  ws.on('error', (err) => {
    console.log("WebSocket error:", err.message);
  });
});
