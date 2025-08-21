import { parentPort, workerData } from "node:worker_threads";
import type { VideoDownloadDto } from "@/models/videos.js";
import YoutubeVideoDownloaderService from "@/services/YoutubeVideoDownloaderService.js";
import CommunicationService, {
  CommunicationServiceClientWorker,
} from "@/services/CommunicationService.js";

const { videoId, audio, video, convert, forceRefresh } =
  workerData as VideoDownloadDto;

const communicationService = new CommunicationService(
  new CommunicationServiceClientWorker(parentPort),
);

async function startTask() {
  const youtubeVideoDownloaderService = new YoutubeVideoDownloaderService(
    videoId,
    communicationService,
  );

  const start = Date.now();

  await youtubeVideoDownloaderService.download({
    audio,
    video,
    convert,
    forceRefresh,
  });

  const end = Date.now();

  return end - start;
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
