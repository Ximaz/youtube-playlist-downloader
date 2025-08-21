import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable, Writable } from "node:stream";
import { ReadableStream as ReadableWebStream } from "node:stream/web";
import { BG, type BgConfig } from "bgutils-js";
import { JSDOM } from "jsdom";
import type { SabrFormat } from "googlevideo/shared-types";
import type { ReloadPlaybackContext } from "googlevideo/protos";
import { SabrStream, type SabrPlaybackOptions } from "googlevideo/sabr-stream";
import { buildSabrFormat, EnabledTrackTypes } from "googlevideo/utils";
import {
  Constants,
  Innertube,
  type IPlayerResponse,
  UniversalCache,
  YTNodes,
} from "youtubei.js";
import { storageServiceS3 } from "@/env.js";
import YoutubeAPI from "@/library/YoutubeAPI/index.js";
import YoutubeArtifactPublisherService from "./YoutubeArtifactPublisherService.js";
import type { VideoDownloadDto } from "@/models/videos.js";
import { rm } from "fs/promises";
import FfmpegService from "@/services/FfmpegService.js";
import CommunicationService, {
  type DownloadWebsocketServiceMessage,
} from "@/services/CommunicationService.js";
import path from "node:path";

export interface DownloadTask {
  read: ReadableStream;
  write: Writable;
  format: SabrFormat;
}

export default class YoutubeVideoDownloaderService {
  constructor(
    private readonly videoId: string,
    private readonly communicationService?: CommunicationService,
  ) {}

  private static async generateWebPoToken(visitorData: string) {
    const requestKey = "O43z0dpjhgX20SCx4KAo";

    if (!visitorData) throw new Error("Could not get visitor data");

    const dom = new JSDOM();

    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
    });

    const bgConfig: BgConfig = {
      fetch: fetch,
      globalObj: globalThis,
      identifier: visitorData,
      requestKey,
    };

    const bgChallenge = await BG.Challenge.create(bgConfig);

    if (!bgChallenge) throw new Error("Could not get challenge");

    const interpreterJavascript =
      bgChallenge.interpreterJavascript
        .privateDoNotAccessOrElseSafeScriptWrappedValue;

    if (interpreterJavascript) {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
      new Function(interpreterJavascript)();
    } else throw new Error("Could not load VM");

    const poTokenResult = await BG.PoToken.generate({
      program: bgChallenge.program,
      globalName: bgChallenge.globalName,
      bgConfig,
    });

    return {
      visitorData,
      poToken: poTokenResult.poToken,
    };
  }

  /**
   * Fetches video details and streaming information from YouTube.
   */
  private static makePlayerRequest(
    innertube: Innertube,
    videoId: string,
    reloadPlaybackContext?: ReloadPlaybackContext,
  ): Promise<IPlayerResponse> {
    const watchEndpoint = new YTNodes.NavigationEndpoint({
      watchEndpoint: { videoId },
    });

    const extraArgs = {
      playbackContext: {
        adPlaybackContext: { pyv: true },
        contentPlaybackContext: {
          vis: 0,
          splay: false,
          lactMilliseconds: "-1",
          signatureTimestamp: innertube.session.player?.sts,
        },
        reloadPlaybackContext: {} satisfies ReloadPlaybackContext,
      },
      contentCheckOk: true,
      racyCheckOk: true,
    };

    if (reloadPlaybackContext) {
      extraArgs.playbackContext.reloadPlaybackContext = reloadPlaybackContext;
    }

    return watchEndpoint.call<IPlayerResponse>(innertube.actions, {
      ...extraArgs,
      parse: true,
    });
  }

  /**
   * Initializes Innertube client and sets up SABR streaming for a YouTube video.
   */
  private static async createSabrStream(
    videoId: string,
    options: SabrPlaybackOptions,
  ) {
    const innertube = await Innertube.create({
      cache: new UniversalCache(true, "/tmp/youtube-playlist-exporter-cache"),
      enable_session_cache: true,
      player_id: "0004de42",
      retrieve_player: true,
    });
    const webPoTokenResult =
      await YoutubeVideoDownloaderService.generateWebPoToken(
        innertube.session.context.client.visitorData || "",
      );

    // Get video metadata.
    const playerResponse =
      await YoutubeVideoDownloaderService.makePlayerRequest(innertube, videoId);
    const videoTitle = playerResponse.video_details?.title || "Unknown Video";

    // Now get the streaming information.
    const serverAbrStreamingUrl = innertube.session.player?.decipher(
      playerResponse.streaming_data?.server_abr_streaming_url,
    );
    const videoPlaybackUstreamerConfig =
      playerResponse.player_config?.media_common_config
        .media_ustreamer_request_config?.video_playback_ustreamer_config;

    if (!videoPlaybackUstreamerConfig)
      throw new Error("ustreamerConfig not found");
    if (!serverAbrStreamingUrl)
      throw new Error("serverAbrStreamingUrl not found");

    const sabrFormats =
      playerResponse.streaming_data?.adaptive_formats.map(buildSabrFormat) ||
      [];

    const serverAbrStream = new SabrStream({
      formats: sabrFormats,
      serverAbrStreamingUrl,
      videoPlaybackUstreamerConfig,
      poToken: webPoTokenResult.poToken,
      clientInfo: {
        clientName: parseInt(
          Constants.CLIENT_NAME_IDS[
            innertube.session.context.client
              .clientName as keyof typeof Constants.CLIENT_NAME_IDS
          ],
        ),
        clientVersion: innertube.session.context.client.clientVersion,
      },
    });

    // Handle player response reload events (e.g, when IP changes, or formats expire).
    serverAbrStream.on("reloadPlayerResponse", (reloadPlaybackContext) => {
      YoutubeVideoDownloaderService.makePlayerRequest(
        innertube,
        videoId,
        reloadPlaybackContext,
      )
        .then((playerResponse) => {
          const serverAbrStreamingUrl = innertube.session.player?.decipher(
            playerResponse.streaming_data?.server_abr_streaming_url,
          );
          const videoPlaybackUstreamerConfig =
            playerResponse.player_config?.media_common_config
              .media_ustreamer_request_config?.video_playback_ustreamer_config;

          if (serverAbrStreamingUrl && videoPlaybackUstreamerConfig) {
            serverAbrStream.setStreamingURL(serverAbrStreamingUrl);
            serverAbrStream.setUstreamerConfig(videoPlaybackUstreamerConfig);
          }
        })
        .catch((err: unknown) => {
          throw err;
        });
    });

    const { videoStream, audioStream, selectedFormats } =
      await serverAbrStream.start(options);

    return {
      innertube,
      streamResults: {
        videoStream,
        audioStream,
        selectedFormats,
        videoTitle,
      },
    };
  }

  private static getEnabledTrackTypes(
    audio: boolean,
    video: boolean,
  ): EnabledTrackTypes {
    if (audio && !video) return EnabledTrackTypes.AUDIO_ONLY;
    if (!audio && video) return EnabledTrackTypes.VIDEO_ONLY;
    if (audio && video) return EnabledTrackTypes.VIDEO_AND_AUDIO;
    throw new Error(
      "At least one channel type must be set to 'true': audio, video",
    );
  }

  private createStreamSink(format: SabrFormat, outputStream: Writable) {
    const communicationService = this.communicationService;
    const progress: DownloadWebsocketServiceMessage = {
      type: "DOWNLOAD",
      videoId: this.videoId,
      processed: 0,
      total: format.contentLength ?? 0,
    };

    return new WritableStream<Uint8Array>({
      write(chunk) {
        progress.processed += chunk.length;
        if (communicationService && progress.total > 0)
          communicationService.sendDownloadProgress(progress);

        return new Promise((resolve, reject) => {
          const canWrite = outputStream.write(chunk, (err) => {
            if (undefined !== err && null !== err) reject(err);
            else if (canWrite) resolve();
          });
          if (!canWrite) outputStream.on("drain", resolve);
        });
      },
      close() {
        outputStream.end();
      },
      abort(err?: Error) {
        outputStream.destroy(err);
      },
    });
  }

  private async downloadStreams(
    audioOutputStream: Writable | null,
    videoOutputStream: Writable | null,
  ) {
    const enabledTrackTypes =
      YoutubeVideoDownloaderService.getEnabledTrackTypes(
        null !== audioOutputStream,
        null !== videoOutputStream,
      );

    const { streamResults } =
      await YoutubeVideoDownloaderService.createSabrStream(this.videoId, {
        preferOpus: true,
        preferWebM: true,
        enabledTrackTypes,
      });

    const { audioStream, videoStream } = streamResults;

    const { audioFormat, videoFormat } = streamResults.selectedFormats;

    const streams: {
      read: ReadableStream; // Import from 'node:streams/web'
      write: Writable;
      format: SabrFormat;
    }[] = [];

    if (null !== audioOutputStream)
      streams.push({
        read: audioStream,
        write: audioOutputStream,
        format: audioFormat,
      });

    if (null !== videoOutputStream)
      streams.push({
        read: videoStream,
        write: videoOutputStream,
        format: videoFormat,
      });

    const parameterizedTasks = streams.map(({ read, write, format }) =>
      read.pipeTo(this.createStreamSink(format, write)),
    );

    await Promise.all(parameterizedTasks);
  }

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

    const videoMetadata = await YoutubeAPI.VideoAPI.getVideoMetadata(
      this.videoId,
    );

    const uploads: Promise<unknown>[] = [];

    const tmpDir = await mkdtemp("ypd");

    const originalAudioPath = audio
      ? path.join("/tmp", tmpDir, "audio.weba")
      : null;
    const originalVideoPath = video
      ? path.join("/tmp", tmpDir, "video.webm")
      : null;

    await this.downloadStreams(
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
      const ffmpegService = new FfmpegService(this.communicationService);

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
      const ffmpegService = new FfmpegService(this.communicationService);
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

  async findBestThumbnailUrl() {
    const thumbnailPaths = [
      "maxresdefault.jpg",
      "sddefault.jpg",
      "hqdefault.jpg",
      "mqdefault.jpg",
    ];

    for (const thumbnailPath of thumbnailPaths) {
      const thumbnailUrl = `https://img.youtube.com/vi/${this.videoId}/${thumbnailPath}`;
      const thumbnailResponse = await fetch(thumbnailUrl, {
        method: "HEAD",
      });

      if (200 === thumbnailResponse.status) return thumbnailUrl;
    }
    return `https://img.youtube.com/vi/${this.videoId}/default.jpg`;
  }

  async downloadThumbnail(thumbnailPath: string) {
    const thumbnailUrl = await this.findBestThumbnailUrl();
    const thumbnailResponse = await fetch(thumbnailUrl);
    if (!thumbnailResponse.ok || null === thumbnailResponse.body)
      throw new Error(
        `Unable to download the thumbnail of the video ${this.videoId}`,
      );

    const outputStream = createWriteStream(thumbnailPath);
    const webStream = Readable.fromWeb(
      thumbnailResponse.body as ReadableWebStream,
    );

    await pipeline(webStream, outputStream);

    outputStream.close();

    return thumbnailPath;
  }
}
