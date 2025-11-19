import type { UUID } from "node:crypto";
import type { UpgradeWebSocket } from "hono/ws";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import CacheRedis from "@internal/cache/cache-redis";
import Zipper from "@internal/zipper/zipper";
import getVideoMetadata from "@internal/youtube-api/videos";
import YoutubeArtifactManager from "@internal/youtube-artifact-manager";
import {
  videosDownloadDto,
  type VideosDownloadDto,
} from "@web/api/videos/dto/videos-download.dto";
import JobsService from "@web/infrastructure/jobs/job.service";
import { redisClient, storageService } from "@web/infrastructure/config/env";
import { DOWNLOAD_VIDEOS_WORKER_PATH } from "@web/infrastructure/workers";
import { videosExportDto } from "@web/api/videos/dto/videos-export.dto";

import CommunicationService, {
  CommunicationServiceClientWebsocket,
} from "@web/infrastructure/communication/communication.service";

const router = new Hono();

router.post("/download", zValidator("json", videosDownloadDto), async (c) => {
  const jobService = JobsService.getInstance();

  const { videoIds, audio, video, convert, forceRefresh } = c.req.valid("json");

  const youtubeArtifactManager = new YoutubeArtifactManager(storageService);

  const missingVideos = (
    await Promise.all(
      videoIds.map(async (videoId) => ({
        videoId,
        missing:
          forceRefresh ||
          !(await youtubeArtifactManager.streamExists(videoId, {
            audio,
            video,
            convert,
          })),
      })),
    )
  )
    .filter(({ missing }) => missing)
    .map(({ videoId }) => videoId);

  const jobIds: string[] = [];

  if (missingVideos.length > 0) {
    jobIds.push(
      ...missingVideos.map((videoId) =>
        jobService.scheduleJob(DOWNLOAD_VIDEOS_WORKER_PATH, {
          videoIds: [videoId],
          audio,
          video,
          convert,
          forceRefresh,
        } satisfies VideosDownloadDto),
      ),
    );
  }

  return c.json({
    status: "success",
    message: null,
    data: {
      cachedVideos: videoIds.filter(
        (videoId) => !missingVideos.includes(videoId),
      ),
      downloadJobIds: jobIds,
    },
  });
});

router.post("/export", zValidator("json", videosExportDto), async (c) => {
  const { videoIds, audio, video, convert } = c.req.valid("json");

  const youtubeArtifactManager = new YoutubeArtifactManager(storageService);

  const missingVideos = (
    await Promise.all(
      videoIds.map(async (videoId) => ({
        videoId,
        missing: !(await youtubeArtifactManager.streamExists(videoId, {
          audio,
          video,
          convert,
        })),
      })),
    )
  )
    .filter(({ missing }) => missing)
    .map(({ videoId }) => videoId);
  if (missingVideos.length > 0) {
    throw new HTTPException(400, {
      message: `Not all the requested videos have been downloaded: ${missingVideos.join(", ")}`,
    });
  }

  const compressVideosService = new Zipper(youtubeArtifactManager);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of compressVideosService.generateArchive(
          videoIds,
          {
            audio,
            video,
            convert,
          },
        )) {
          controller.enqueue(chunk);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="playlist.zip"',
    },
  });
});

router.get("/:id", async (c) => {
  const { id } = c.req.param();

  const cache = new CacheRedis(900, redisClient);

  const forceRefresh = undefined !== c.req.header("X-Force-Refresh");
  const cachedVideoMetadata = await cache.getVideoMetadata(id, forceRefresh);
  if (null !== cachedVideoMetadata) {
    return c.json({
      status: "success",
      message: null,
      data: c.json(cachedVideoMetadata),
    });
  }

  const videoMetadata = await getVideoMetadata(id);

  await cache.setVideoMetadata(id, videoMetadata);

  return c.json({
    status: "success",
    message: null,
    data: videoMetadata,
  });
});

export function injectWebSocketUpgrade(
  router: Hono,
  upgradeWebSocket: UpgradeWebSocket,
) {
  router.get(
    "/jobs/",
    upgradeWebSocket(() => {
      return {
        onMessage(evt, ws) {
          const jobIds = JSON.parse(evt.data as string) as UUID[];
          if (jobIds.length === 0) {
            const communicationService = new CommunicationService(
              new CommunicationServiceClientWebsocket(ws),
            );

            communicationService.sendClose();
            ws.close();
            return void 0;
          }

          const jobService = JobsService.getInstance();
          for (const jobId of jobIds) jobService.bindWebsocket(jobId, ws);
        },
      };
    }),
  );

  return router;
}

export default router;
