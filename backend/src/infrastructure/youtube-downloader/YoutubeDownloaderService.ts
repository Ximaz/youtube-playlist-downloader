import { createWriteStream } from "node:fs";
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
  YTNodes,
} from "youtubei.js";
import CommunicationService, {
  type DownloadWebsocketServiceMessage,
} from "@/infrastructure/communication/CommunicationService.js";
import { Platform, UniversalCache, type Types } from "youtubei.js/web";

Platform.shim.eval = (
  data: Types.BuildScriptResult,
  env: Record<string, Types.VMPrimative>,
) => {
  const properties = [];

  if (env.n) {
    properties.push(`n: exportedVars.nFunction("${env["n"].toString()}")`);
  }

  if (env.sig) {
    properties.push(
      `sig: exportedVars.sigFunction("${env["sig"].toString()}")`,
    );
  }

  const code = `${data.output}\nreturn { ${properties.join(", ")} }`;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  return new Function(code)();
};

export interface DownloadTask {
  read: ReadableStream;
  write: Writable;
  format: SabrFormat;
}

export default class YoutubeDownloaderService {
  constructor(
    private readonly videoId: string,
    private readonly communicationService?: CommunicationService,
  ) {}

  private async findBestThumbnailUrl() {
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
          signatureTimestamp: innertube.session.player?.signature_timestamp,
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
      cache: new UniversalCache(true),
      enable_session_cache: true,
      retrieve_player: true,
    });
    const webPoTokenResult = await YoutubeDownloaderService.generateWebPoToken(
      innertube.session.context.client.visitorData || "",
    );

    // Get video metadata.
    const playerResponse = await YoutubeDownloaderService.makePlayerRequest(
      innertube,
      videoId,
    );
    const videoTitle = playerResponse.video_details?.title || "Unknown Video";

    // Now get the streaming information.
    const serverAbrStreamingUrl = await innertube.session.player?.decipher(
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
      YoutubeDownloaderService.makePlayerRequest(
        innertube,
        videoId,
        reloadPlaybackContext,
      )
        .then(async (playerResponse) => {
          const serverAbrStreamingUrl =
            await innertube.session.player?.decipher(
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

  async downloadStreams(
    audioOutputStream: Writable | null,
    videoOutputStream: Writable | null,
  ) {
    const enabledTrackTypes = YoutubeDownloaderService.getEnabledTrackTypes(
      null !== audioOutputStream,
      null !== videoOutputStream,
    );

    const { streamResults } = await YoutubeDownloaderService.createSabrStream(
      this.videoId,
      {
        preferOpus: true,
        preferWebM: true,
        enabledTrackTypes,
      },
    );

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
