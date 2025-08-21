import { Hono } from "hono";
import { compress } from "hono/compress";
import { logger as loggerHook } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { PORT } from "@/env.js";
import videosRouter, { injectWebSocketUpgrade } from "@/controllers/videos.js";
import LoggerService from "@/services/LoggerService.js";

const app = new Hono();

const websocketHandler = createNodeWebSocket({ app });
const videosWebsocketRouter = injectWebSocketUpgrade(
  videosRouter,
  websocketHandler.upgradeWebSocket,
);

app.use(loggerHook(LoggerService.logger.info), compress());

app.onError((err) => {
  LoggerService.logger.error(err.message, {
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

const server = serve(
  {
    fetch: app.fetch,
    port: PORT,
    hostname: "0.0.0.0",
  },
  (info) => {
    LoggerService.logger.info(
      `Server is running on http://${info.address}:${info.port.toString()}`,
    );
  },
);

websocketHandler.injectWebSocket(server);
