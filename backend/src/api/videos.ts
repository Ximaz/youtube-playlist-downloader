import type { UUID } from "node:crypto";
import { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import { zValidator } from "@hono/zod-validator";
import JobsService from "@/infrastructure/jobs/JobsService.js";
import {
  DOWNLOAD_VIDEOS_WORKER_PATH,
  EXPORT_VIDEOS_WORKER_PATH,
} from "@/infrastructure/workers/index.js";
import cacheMiddleware from "@/api/middlewares/CacheMiddleware.js";
import CommunicationService, {
  CommunicationServiceClientWebsocket,
} from "@/infrastructure/communication/CommunicationService.js";
import { HTTPException } from "hono/http-exception";
import ZipperService from "@/infrastructure/zipper/ZipperService.js";
import youtubeApi from "@/application/youtube-api/index.js";
import {
  videosDownloadDto,
  videosExportDto,
  type VideoDownloadDto,
  type VideosDownloadDto,
} from "./schemas/videos.js";
import YoutubeArtifactPublisherService from "@/application/artifact/PublishYoutubeStreamArtifact.js";
import { storageServiceS3 } from "@/infrastructure/config/env.js";

const videosRouter = new Hono();

videosRouter.get("/playlists/:playlistId", cacheMiddleware, async (c) => {
  const { playlistId } = c.req.param();

  const playlistMetadata =
    await youtubeApi.PlaylistAPI.getPlaylistMetadata(playlistId);

  return c.json({
    status: "success",
    message: null,
    data: playlistMetadata,
  });
});

videosRouter.post(
  "/download",
  zValidator("json", videosDownloadDto),
  async (c) => {
    const jobService = JobsService.getInstance();

    const { videoIds, audio, video, convert, forceRefresh } =
      c.req.valid("json");

    const youtubeArtifactPublisherService = new YoutubeArtifactPublisherService(
      storageServiceS3,
    );

    const missingVideos = (
      await Promise.all(
        videoIds.map(async (videoId) => ({
          videoId,
          missing:
            forceRefresh ||
            !(await youtubeArtifactPublisherService.streamExists(videoId, {
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
            videoId,
            audio,
            video,
            convert,
            forceRefresh,
          } satisfies VideoDownloadDto),
        ),
      );
    }

    const compressJobId = jobService.scheduleJob(EXPORT_VIDEOS_WORKER_PATH, {
      videoIds,
      audio,
      video,
      convert,
      forceRefresh,
    } satisfies VideosDownloadDto);

    return c.json({
      status: "success",
      message: null,
      data: {
        cachedVideos: videoIds.filter(
          (videoId) => !missingVideos.includes(videoId),
        ),
        downloadJobIds: jobIds,
        compressJobId,
      },
    });
  },
);

videosRouter.post("/export", zValidator("json", videosExportDto), async (c) => {
  const { videoIds, audio, video, convert } = c.req.valid("json");

  const youtubeArtifactPublisherService = new YoutubeArtifactPublisherService(
    storageServiceS3,
  );

  const missingVideos = (
    await Promise.all(
      videoIds.map(async (videoId) => ({
        videoId,
        missing: !(await youtubeArtifactPublisherService.streamExists(videoId, {
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

  const compressVideosService = new ZipperService(
    youtubeArtifactPublisherService,
  );

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of compressVideosService.generateArchive({
          videoIds,
          audio,
          video,
          convert,
        })) {
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

videosRouter.get("/:videoId", cacheMiddleware, async (c) => {
  const { videoId } = c.req.param();

  const videoMetadata = await youtubeApi.VideoAPI.getVideoMetadata(videoId);

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

export default videosRouter;
