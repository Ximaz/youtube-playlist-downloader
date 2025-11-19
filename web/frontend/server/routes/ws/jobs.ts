import { defineWebSocketHandler } from "h3";
import WebSocket from "ws";

export default defineWebSocketHandler({
  open(peer) {
    const url = new URL(process.env["BACKEND_API"] as string);
    const target = new WebSocket(`ws://${url.host}/videos/jobs/`);
    const missedMessages: MessageEvent[] = [];

    target.on("open", () => {
      for (const missedMessage of missedMessages)
        target.send(missedMessage.data, (err) => {
          if (err) console.error(err);
        });
    });

    target.on("message", (message, isBinary) => {
      if (isBinary) {
        peer.send(message);
      } else {
        peer.send(message.toString());
      }
    });

    peer.websocket.onmessage = (msg) => {
      if (target.readyState === WebSocket.OPEN)
        target.send(msg.data, (err) => {
          if (err) console.error(err);
        });
      else missedMessages.push(msg);
    };
  },
  close(peer, { code, reason }) {
    peer.close(code, reason);
  },
});
