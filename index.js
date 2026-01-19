import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: process.env.PORT || 3000 });

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    // просто ретрансляция всем
    wss.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(data.toString());
      }
    });
  });
});

console.log("WebSocket IRC server started");
