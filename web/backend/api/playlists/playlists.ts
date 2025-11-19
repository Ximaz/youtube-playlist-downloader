import { Hono } from "hono";
import CacheRedis from "@internal/cache/cache-redis";
import getPlaylistMetadata from "@internal/youtube-api/playlists";
import { redisClient } from "@web/infrastructure/config/env";

const router = new Hono();

router.get("/:id", async (c) => {
  const { id } = c.req.param();

  const cache = new CacheRedis(900, redisClient);

  const forceRefresh = undefined !== c.req.header("X-Force-Refresh");
  const cachedVideoMetadata = await cache.getPlaylistMetadata(id, forceRefresh);
  if (null !== cachedVideoMetadata) {
    return c.json({
      status: "success",
      message: null,
      data: cachedVideoMetadata,
    });
  }

  const playlistMetadata = await getPlaylistMetadata(id);

  await cache.setPlaylistMetadata(id, playlistMetadata);

  await Promise.all(
    playlistMetadata.videos.map((video) =>
      cache.setVideoMetadata(video.videoId, video),
    ),
  );

  return c.json({
    status: "success",
    message: null,
    data: playlistMetadata,
  });
});

export default router;
