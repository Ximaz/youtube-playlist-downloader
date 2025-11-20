import path from "node:path";
import { tmpdir } from "node:os";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import { mergeToWEBM, mergeToMPEG } from "@internal/convertor/merge-convertor";
import audioConvertor from "@internal/convertor/audio-convertor";
import videoConvertor from "@internal/convertor/video-convertor";
import getVideoMetadata from "@internal/youtube-api/videos";
import { downloadThumbnail } from "@internal/youtube-api/thumbnail";
import YoutubeVideoDownloader from "@internal/youtube-video-downloader";
import YoutubeArtifactManager from "@internal/youtube-artifact-manager";
import { storageService } from "@web/infrastructure/config/env";
import type { VideosDownloadDto } from "@web/api/videos/dto/videos-download.dto";
import CommunicationService, {
  CommunicationServiceClientWorker,
} from "@web/infrastructure/communication/communication.service";

const { videoIds, audio, video, convert } = workerData as VideosDownloadDto;

const communicationService = new CommunicationService(
  new CommunicationServiceClientWorker(parentPort)
);

async function startTask() {
  const videoId = videoIds[0]!;

  const outputPath = await mkdtemp(path.join(tmpdir(), `ypd-${videoId}`));
  const downloader = await YoutubeVideoDownloader(videoId, outputPath);

  let audioDownloadTotal: number = 0;
  let videoDownloadTotal: number = 0;
  let audioDownloadProcessed: number = 100;
  let videoDownloadProcessed: number = 100;

  const start = Date.now();

  const { audio: audioPath, video: videoPath } = await downloader.download(
    {
      audio,
      video,
    },
    (progress) => {
      if (progress.type === "audio") {
        audioDownloadProcessed = progress.receivedBytes;
        audioDownloadTotal = progress.totalBytes;
      }
      if (progress.type === "video") {
        videoDownloadProcessed = progress.receivedBytes;
        videoDownloadTotal = progress.totalBytes;
      }

      communicationService.sendDownloadProgress({
        videoId: progress.videoId,
        type: "DOWNLOAD",
        processed: (audioDownloadProcessed + videoDownloadProcessed) / 200,
        total: audioDownloadTotal + videoDownloadTotal,
      });
    }
  );

  const videoMetadata = await getVideoMetadata(videoId);
  const youtubeArtifactManager = new YoutubeArtifactManager(storageService);

  let uploads: Promise<unknown>[] = [];

  if (undefined !== audioPath) {
    uploads.push(
      youtubeArtifactManager.pushStream(
        videoId,
        createReadStream(audioPath, { autoClose: true }),
        videoMetadata,
        "audio/weba",
        { audio: true, video: false, convert: false }
      )
    );
  }

  if (undefined !== videoPath) {
    uploads.push(
      youtubeArtifactManager.pushStream(
        videoId,
        createReadStream(videoPath, { autoClose: true }),
        videoMetadata,
        "video/webm",
        { audio: false, video: true, convert: false }
      )
    );
  }

  // Initial audio and / or video WEBM must be downloaded before continuing to
  // avoid race conditions.
  await Promise.all(uploads);

  uploads = [];

  if (undefined !== audioPath && undefined !== videoPath) {
    uploads.push(
      (async () => {
        const [_, convertedStream] = await mergeToWEBM(
          audioPath,
          videoPath,
          path.join(
            outputPath,
            videoMetadata.title.replaceAll(path.sep, "_") + ".webm"
          ),
          ({ processed, total }) => {
            communicationService.sendConvertProgress({
              processed,
              total,
              type: "CONVERT",
              videoId,
            });
          }
        );

        // Making sure the conversion results in a 100%
        communicationService.sendConvertProgress({
          processed: 1,
          total: 1,
          type: "CONVERT",
          videoId,
        });

        await youtubeArtifactManager.pushStream(
          videoId,
          convertedStream,
          videoMetadata,
          "video/webm",
          { audio, video, convert }
        );
      })()
    );
  }

  if (convert) {
    if (audio && !video) {
      uploads.push(
        (async () => {
          const thumbnailPath = await downloadThumbnail(
            videoMetadata.thumbnailUrl,
            path.join(outputPath, "thumbnail.jpeg")
          );

          const [_, convertedStream] = await audioConvertor(
            audioPath!,
            path.join(
              outputPath,
              videoMetadata.title.replaceAll(path.sep, "_") + ".m4a"
            ),
            ({ processed, total }) => {
              communicationService.sendConvertProgress({
                processed,
                total,
                type: "CONVERT",
                videoId,
              });
            },
            {
              metadata: videoMetadata,
              thumbnailPath: thumbnailPath,
            }
          );

          // Making sure the conversion results in a 100%
          communicationService.sendConvertProgress({
            processed: 1,
            total: 1,
            type: "CONVERT",
            videoId,
          });

          await youtubeArtifactManager.pushStream(
            videoId,
            convertedStream,
            videoMetadata,
            "audio/mpeg",
            { audio, video, convert }
          );
        })()
      );
    }

    if (!audio && video) {
      uploads.push(
        (async () => {
          const [_, convertedStream] = await videoConvertor(
            videoPath!,
            path.join(
              outputPath,
              videoMetadata.title.replaceAll(path.sep, "_") + ".mp4"
            ),
            ({ processed, total }) => {
              communicationService.sendConvertProgress({
                processed,
                total,
                type: "CONVERT",
                videoId,
              });
            }
          );

          // Making sure the conversion results in a 100%
          communicationService.sendConvertProgress({
            processed: 1,
            total: 1,
            type: "CONVERT",
            videoId,
          });

          await youtubeArtifactManager.pushStream(
            videoId,
            convertedStream,
            videoMetadata,
            "video/mp4",
            { audio, video, convert }
          );
        })()
      );
    }

    if (audio && video) {
      uploads.push(
        (async () => {
          const [_, convertedStream] = await mergeToMPEG(
            audioPath!,
            videoPath!,
            path.join(
              outputPath,
              videoMetadata.title.replaceAll(path.sep, "_") + ".mp4"
            ),
            ({ processed, total }) => {
              communicationService.sendConvertProgress({
                processed,
                total,
                type: "CONVERT",
                videoId,
              });
            }
          );

          // Making sure the conversion results in a 100%
          communicationService.sendConvertProgress({
            processed: 1,
            total: 1,
            type: "CONVERT",
            videoId,
          });

          await youtubeArtifactManager.pushStream(
            videoId,
            convertedStream,
            videoMetadata,
            "video/mp4",
            { audio, video, convert }
          );
        })()
      );
    }
  }

  await Promise.all(uploads);

  const end = Date.now();

  await rm(outputPath, { force: true, recursive: true });

  return end - start;
}

parentPort?.on("message", (message) => {
  if (message !== "start") return void 0;
  startTask()
    .then((_timeToComplete) => {
      communicationService.sendClose();
    })
    .catch((err: unknown) => {
      console.error(err);
      communicationService.sendError(err as Error);
    })
    .finally(() => {
      parentPort?.close();
      parentPort?.close();
      process.exit(0);
    });
});
