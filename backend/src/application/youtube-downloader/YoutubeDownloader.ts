import path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { rm, mkdtemp } from "node:fs/promises";
import type { VideoDownloadDto } from "@/api/schemas/videos.js";
import youtubeApi from "@/application/youtube-api/index.js";
import YoutubeArtifactPublisherService from "@/application/artifact/PublishYoutubeStreamArtifact.js";
import FFMPEGService from "@/infrastructure/ffmpeg/FFMPEGService.js";
import CommunicationService from "@/infrastructure/communication/CommunicationService.js";
import { storageServiceS3 } from "@/infrastructure/config/env.js";
import type YoutubeDownloaderService from "@/infrastructure/youtube-downloader/YoutubeDownloaderService.js";

export default class YoutubeDownloader {
  constructor(
    private readonly videoId: string,
    private readonly youtubeDownloaderService: YoutubeDownloaderService,
    private readonly communicationService?: CommunicationService,
  ) {}

  async download({
    audio,
    video,
    convert,
    forceRefresh,
  }: Omit<VideoDownloadDto, "videoId">) {
    const youtubeArtifactPublisherService = new YoutubeArtifactPublisherService(
      storageServiceS3,
    );

    const videoExists = await youtubeArtifactPublisherService.streamExists(
      this.videoId,
      {
        audio,
        video,
        convert,
      },
    );

    if (videoExists && !forceRefresh) return void 0;

    const videoMetadata = await youtubeApi.VideoAPI.getVideoMetadata(
      this.videoId,
    );

    const uploads: Promise<unknown>[] = [];

    const tmpDir = await mkdtemp("/tmp/ypd");

    const originalAudioPath = audio ? path.join(tmpDir, "audio.weba") : null;
    const originalVideoPath = video ? path.join(tmpDir, "video.webm") : null;

    await this.youtubeDownloaderService.downloadStreams(
      originalAudioPath
        ? createWriteStream(originalAudioPath, { autoClose: true })
        : null,
      originalVideoPath
        ? createWriteStream(originalVideoPath, { autoClose: true })
        : null,
    );

    if (null !== originalAudioPath) {
      uploads.push(
        youtubeArtifactPublisherService.pushStream(
          this.videoId,
          createReadStream(originalAudioPath, { autoClose: true }),
          videoMetadata,
          "audio/weba",
          { audio: true, video: false, convert: false },
        ),
      );
    }

    if (null !== originalVideoPath) {
      uploads.push(
        youtubeArtifactPublisherService.pushStream(
          this.videoId,
          createReadStream(originalVideoPath, { autoClose: true }),
          videoMetadata,
          "video/webm",
          { audio: false, video: true, convert: false },
        ),
      );
    }

    await Promise.all(uploads);

    if (null !== originalAudioPath && null !== originalVideoPath) {
      // Must use ffmpeg for WEBM merge, even if 'convert' is not set.
      const ffmpegService = new FFMPEGService(this.communicationService);

      const [tmpMergedReadPath, mergedReadStream] =
        await ffmpegService.mergeAudioAndVideoStreams(
          originalAudioPath,
          originalVideoPath,
          this.videoId,
          path.join(tmpDir, "merged.webm"),
        );

      void (await youtubeArtifactPublisherService.pushStream(
        this.videoId,
        mergedReadStream,
        videoMetadata,
        "video/webm",
        { audio: true, video: true, convert: false },
      ));

      await rm(tmpMergedReadPath);
    }

    if (convert) {
      const ffmpegService = new FFMPEGService(this.communicationService);
      if (audio && null !== originalAudioPath && !video) {
        const thumbnailPath = await this.downloadThumbnail(
          path.join(tmpDir, "thumbnail.jpg"),
        );

        const [tmpConvertAudioStreamPath, convertedAudioStream] =
          await ffmpegService.convertAudioToMPEG(
            originalAudioPath,
            this.videoId,
            path.join(tmpDir, "audio.m4a"),
            {
              thumbnailPath,
              metadata: videoMetadata,
            },
          );

        void (await youtubeArtifactPublisherService.pushStream(
          this.videoId,
          convertedAudioStream,
          videoMetadata,
          "audio/mpeg",
          { audio: true, video: false, convert: true },
        ));

        await rm(tmpConvertAudioStreamPath);
      }

      if (!audio && video && null !== originalVideoPath) {
        const [tmpConvertVideoStreamPath, convertedVideoStream] =
          await ffmpegService.convertVideoToMPEG(
            this.videoId,
            originalVideoPath,
            path.join(tmpDir, "video.mp4"),
          );

        void (await youtubeArtifactPublisherService.pushStream(
          this.videoId,
          convertedVideoStream,
          videoMetadata,
          "video/mp4",
          { audio: false, video: true, convert: true },
        ));

        await rm(tmpConvertVideoStreamPath);
      }
      if (
        audio &&
        null !== originalAudioPath &&
        video &&
        null !== originalVideoPath
      ) {
        const [tmpConvertedMergedStreamPath, convertedMergedStream] =
          await ffmpegService.mergeAudioAndVideoStreamsToMPEG(
            originalAudioPath,
            originalVideoPath,
            this.videoId,
            path.join(tmpDir, "merged.mp4"),
          );

        void (await youtubeArtifactPublisherService.pushStream(
          this.videoId,
          convertedMergedStream,
          videoMetadata,
          "video/mp4",
          { audio: true, video: true, convert: true },
        ));

        await rm(tmpConvertedMergedStreamPath);
      }
    }

    await rm(tmpDir, { force: true, recursive: true });
  }

  async downloadThumbnail(thumbnailPath: string) {
    return this.youtubeDownloaderService.downloadThumbnail(thumbnailPath);
  }
}
