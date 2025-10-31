import { parentPort, workerData } from "node:worker_threads";
import CommunicationService, {
  CommunicationServiceClientWorker,
} from "@/infrastructure/communication/CommunicationService.js";
import type { VideoDownloadDto } from "@/api/schemas/videos.js";
import YoutubeDownloader from "@/application/youtube-downloader/YoutubeDownloader.js";
import YoutubeDownloaderService from "../youtube-downloader/YoutubeDownloaderService.js";

const { videoId, audio, video, convert, forceRefresh } =
  workerData as VideoDownloadDto;

const communicationService = new CommunicationService(
  new CommunicationServiceClientWorker(parentPort),
);

async function startTask() {
  const youtubeVideoDownloaderService = new YoutubeDownloader(
    videoId,
    new YoutubeDownloaderService(videoId, communicationService),
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
