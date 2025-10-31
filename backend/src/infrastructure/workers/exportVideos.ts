import path from "node:path";
import { Readable } from "node:stream";
import { parentPort, workerData } from "node:worker_threads";
import archiver from "archiver";
import CommunicationService, {
  CommunicationServiceClientWorker,
  type CompressWebsocketServiceMessage,
} from "@/infrastructure/communication/CommunicationService.js";
import type { VideosDownloadDto } from "@/api/schemas/videos.js";
import YoutubeArtifactPublisherService, {
  type YoutubeArtifactMetadata,
} from "@/application/artifact/PublishYoutubeStreamArtifact.js";
import { storageServiceS3 } from "../config/env.js";
import type { StoragePath } from "../storage/storage.js";

const { videoIds, audio, video, convert } = workerData as VideosDownloadDto;

const communicationService = new CommunicationService(
  new CommunicationServiceClientWorker(parentPort),
);

async function startTask() {
  const youtubeArtifactPublisherService = new YoutubeArtifactPublisherService(
    storageServiceS3,
  );

  const streams = await youtubeArtifactPublisherService.pullVideosStreams(
    videoIds,
    { audio, video, convert },
  );

  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.on("progress", ({ entries }) => {
    const progress: CompressWebsocketServiceMessage = {
      type: "COMPRESS",
      total: entries.total,
      processed: entries.processed,
    };

    communicationService.sendCompressProgress(progress);
  });

  archive.on("data", (chunk: Buffer) => {
    const bytes = chunk.buffer.slice(
      chunk.byteOffset,
      chunk.byteOffset + chunk.byteLength,
    );

    communicationService.sendCompressedBytes(bytes as ArrayBuffer);
  });

  for (const { stream, metadata, path: filepath } of streams as {
    stream: Readable;
    metadata: YoutubeArtifactMetadata;
    path: StoragePath;
  }[]) {
    const filename = `${metadata.title}${path.extname(filepath.filename)}`;

    archive.append(stream, {
      name: path.join("/", "youtube-videos/", filename),
      date: metadata.date,
    });
  }

  return await new Promise<number>((resolve, reject) => {
    const start = Date.now();

    archive.on("close", () => {
      resolve(Date.now() - start);
    });

    archive.on("error", reject);

    void archive.finalize();
  });
}

parentPort?.on("message", (message) => {
  if (message !== "start") return void 0;
  startTask()
    .then((timeToComplete) => {
      console.log(
        `Time to complete: ${(timeToComplete / 1000).toFixed(1)} seconds`,
      );
      communicationService.sendClose();
      parentPort?.close();
    })
    .catch((err: unknown) => {
      console.error(err);
      communicationService.sendError(err as Error);
      parentPort?.close();
    });
});
