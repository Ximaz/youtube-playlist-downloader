import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";
import { HTTPException } from "hono/http-exception";
import videosRouter, { injectWebSocketUpgrade } from "@web/api/videos/videos";
import playlistsRouter from "@web/api/playlists/playlists";
import { PORT, redisClient } from "@web/infrastructure/config/env";

const app = new Hono();

await redisClient.connect();

const videosWebsocketRouter = injectWebSocketUpgrade(
  videosRouter,
  upgradeWebSocket,
);

app.onError((err) => {
  console.error(err.message, {
    name: err.name,
    stack: err.stack,
    cause: err.cause,
  });

  return new Response(
    JSON.stringify({
      status: "error",
      message: err.message,
      data: null,
    }),
    { status: err instanceof HTTPException ? err.status : 500 },
  );
});

app.route("/videos", videosWebsocketRouter);

app.route("/playlists", playlistsRouter);

export default {
  fetch: app.fetch,
  websocket,
  hostname: "0.0.0.0",
  port: PORT,
};
