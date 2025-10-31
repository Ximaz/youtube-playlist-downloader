import * as crypto from "node:crypto";
import { createMiddleware } from "hono/factory";
import { redisClient } from "@/infrastructure/config/env.js";

const client = await redisClient.on("error", console.error).connect();

const cacheMiddleware = createMiddleware(async (c, next) => {
  const cacheKey = c.req.method + c.req.url;
  const derivedCacheKey = crypto
    .createHash("md5")
    .update(cacheKey)
    .digest("hex");

  const forceRefresh = undefined !== c.req.header("X-Force-Refresh");
  if (!forceRefresh) {
    const cached = await client.get(derivedCacheKey);
    if (cached) return c.json(JSON.parse(cached));
  }

  await next();

  const originalResponse = c.res;
  const data = await originalResponse.clone().text();
  await client.set(derivedCacheKey, data, {
    expiration: {
      type: "EX",
      value: Date.now() + 900,
    },
    GET: true,
  });
  return originalResponse;
});

export default cacheMiddleware;
