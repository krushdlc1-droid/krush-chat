import WebSocket, { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

console.log("WebSocket IRC server started");

// XOR (как в Java)
function cypher(input) {
  const buf = Buffer.from(input, 'utf8');
  for (let i = 0; i < buf.length; i++) {
    buf[i] = buf[i] ^ 0x15;
  }
  return buf.toString('utf8');
}

// clientId -> prefix
const prefixes = new Map();

wss.on('connection', (ws, req) => {
  const clientId = req.headers['sec-websocket-key'] || 'unknown';
  console.log("Client connected:", clientId);

  ws.on('message', (raw) => {
    try {
      const decoded = cypher(raw.toString());
      const data = JSON.parse(decoded);

      // ===== GET PREFIX =====
      if (data.type === "get_prefix") {
        ws.send(cypher(JSON.stringify({
          type: "prefix_info",
          prefix: prefixes.get(data.clientId) || ""
        })));
        return;
      }

      // ===== SET PREFIX =====
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
      console.log("Message error:", e.message);
    }
  });

  ws.on('close', () => {
    console.log("Client disconnected:", clientId);
  });
});
