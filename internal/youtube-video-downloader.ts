import { createWriteStream, type WriteStream } from "node:fs";
import { JSDOM } from "jsdom";
import { BG, type BgConfig } from "bgutils-js";
import { EnabledTrackTypes, buildSabrFormat } from "googlevideo/utils";
import type { SabrFormat } from "googlevideo/shared-types";
import type { ReloadPlaybackContext } from "googlevideo/protos";
import { SabrStream, type SabrPlaybackOptions } from "googlevideo/sabr-stream";
import {
  Constants,
  Innertube,
  Platform,
  UniversalCache,
  YTNodes,
  type Types,
  type IPlayerResponse,
} from "youtubei.js";
import FormatXTags from "youtubei.js/";

Platform.shim.eval = async (
  data: Types.BuildScriptResult,
  env: Record<string, Types.VMPrimative>
) => {
  const properties = [];

  if (env.n) properties.push(`n: exportedVars.nFunction("${env.n}")`);
  if (env.sig) properties.push(`sig: exportedVars.sigFunction("${env.sig}")`);

  const code = `${data.output}\nreturn { ${properties.join(", ")} }`;
  return new Function(code)();
};

export declare type ProgressCallback = (info: {
  videoId: string;
  type: "audio" | "video";
  receivedBytes: number;
  totalBytes: number;
  percentage: number;
}) => void;

function determineFileExtension(mimeType: string): string {
  if (mimeType.includes("video"))
    return mimeType.includes("webm") ? "webm" : "mp4";
  if (mimeType.includes("audio"))
    return mimeType.includes("webm") ? "webm" : "m4a";
  return "bin";
}

class OutputFileFactory {
  create(
    title: string,
    mimeType: string,
    outputFolder: string
  ): { stream: WriteStream; filePath: string } {
    const type = mimeType.includes("video") ? "video" : "audio";
    const sanitized = title?.replace(/[^\x20-\x7E]+/gi, "_") || "unknown";
    const ext = determineFileExtension(mimeType);
    const name = `${sanitized}.${type}.${ext}`;

    const filePath = `${outputFolder}/${name}`;

    return {
      stream: createWriteStream(filePath, { flags: "w", encoding: "binary" }),
      filePath,
    };
  }
}

class StreamSinkFactory {
  create(
    videoId: string,
    format: SabrFormat,
    out: WriteStream,
    onProgress?: ProgressCallback,
    type?: "audio" | "video"
  ) {
    let size = 0;
    let lastEmit = 101;
    const total = Number(format.contentLength || 0);
    return new WritableStream({
      write(chunk) {
        size += chunk.length;

        if (
          Date.now() - lastEmit > 100 &&
          onProgress &&
          total > 0 &&
          undefined !== type
        ) {
          onProgress({
            videoId,
            type,
            receivedBytes: size,
            totalBytes: total,
            percentage: (size / total) * 100,
          });
          lastEmit = Date.now();
        }

        return new Promise((resolve, reject) =>
          out.write(chunk, (err) => (err ? reject(err) : resolve()))
        );
      },
      close() {
        out.end();
      },
    });
  }
}

class PlayerRequestService {
  constructor(private readonly innertube: Innertube) {}

  async fetch(
    videoId: string,
    reload?: ReloadPlaybackContext
  ): Promise<IPlayerResponse> {
    const endpoint = new YTNodes.NavigationEndpoint({
      watchEndpoint: { videoId },
    });

    const extra = {
      playbackContext: {
        adPlaybackContext: { pyv: true },
        contentPlaybackContext: {
          vis: 0,
          splay: false,
          lactMilliseconds: "-1",
          signatureTimestamp:
            this.innertube.session.player?.signature_timestamp,
        },
        ...(reload ? { reloadPlaybackContext: reload } : {}),
      },
      contentCheckOk: true,
      racyCheckOk: true,
    };

    return endpoint.call<IPlayerResponse>(this.innertube.actions, {
      ...extra,
      parse: true,
    });
  }
}

class WebPoTokenService {
  async generate(contentBinding: string) {
    const requestKey = "O43z0dpjhgX20SCx4KAo";
    if (!contentBinding) throw new Error("No visitor data");

    const dom = new JSDOM();
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
    });

    const cfg: BgConfig = {
      fetch: (input: string | URL, init?: RequestInit | BunFetchRequestInit) =>
        fetch(input, init),
      globalObj: globalThis,
      identifier: contentBinding,
      requestKey,
    };

    const challenge = await BG.Challenge.create(cfg);
    if (!challenge) throw new Error("Challenge failed");

    const js =
      challenge.interpreterJavascript
        .privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (js) new Function(js)();

    const po = await BG.PoToken.generate({
      program: challenge.program,
      globalName: challenge.globalName,
      bgConfig: cfg,
    });

    return {
      visitorData: contentBinding,
      placeholderPoToken: BG.PoToken.generatePlaceholder(contentBinding),
      poToken: po.poToken,
    };
  }
}

export interface KeyValuePair {
  key?: string | undefined;
  value?: string | undefined;
}

class SabrStreamFactory {
  constructor(
    private readonly innertube: Innertube,
    private readonly player: PlayerRequestService,
    private readonly webPo: WebPoTokenService
  ) {}

  async create(videoId: string, opts: SabrPlaybackOptions) {
    const po = await this.webPo.generate(videoId);
    const response = await this.player.fetch(videoId);

    const title = response.video_details?.title || "Unknown Video";

    const serverUrl = await this.innertube.session.player?.decipher(
      response.streaming_data?.server_abr_streaming_url
    );
    const cfg =
      response.player_config?.media_common_config.media_ustreamer_request_config
        ?.video_playback_ustreamer_config;

    if (!cfg || !serverUrl) throw new Error("Missing streaming config");

    const sabrFormats = response.streaming_data?.adaptive_formats
      .filter((format) => {
        // NOTE: This filter is a temporary solution before the actual patch is
        // being merged to allow for ignoring 'is_vb' (Voice Boost). It can
        // cause issues for some video streams.
        // To get more details :
        // https://github.com/LuanRT/YouTube.js/issues/1095

        if (!format.xtags) {
          return !("is_vb" in format);
        }
        function base64ToU8(base64: string): Uint8Array {
          const standard_base64 = base64.replace(/-/g, "+").replace(/_/g, "/");
          const padded_base64 = standard_base64.padEnd(
            standard_base64.length + ((4 - (standard_base64.length % 4)) % 4),
            "="
          );
          return new Uint8Array(
            Buffer.from(padded_base64, "base64")
              .toString("utf-8")
              .split("")
              .map((char) => char.charCodeAt(0))
          );
        }

        const bytes = base64ToU8(format.xtags);
        const isVb =
          bytes.length >= 9 &&
          bytes[4]! == 118 && // 'v'
          bytes[5]! == 98 && // 'b'
          bytes[8]! == 49; // '1'
        return !isVb;
      })
      .map(buildSabrFormat);

    const stream = new SabrStream({
      formats: sabrFormats,
      serverAbrStreamingUrl: serverUrl,
      videoPlaybackUstreamerConfig: cfg,
      poToken: po.poToken,
      clientInfo: {
        clientName: parseInt(
          Constants.CLIENT_NAME_IDS[
            this.innertube.session.context.client
              .clientName as keyof typeof Constants.CLIENT_NAME_IDS
          ]
        ),
        clientVersion: this.innertube.session.context.client.clientVersion,
      },
    });

    stream.on("reloadPlayerResponse", async (reloadCtx) => {
      const refreshed = await this.player.fetch(videoId, reloadCtx);

      const newUrl = await this.innertube.session.player?.decipher(
        refreshed.streaming_data?.server_abr_streaming_url
      );
      const newCfg =
        refreshed.player_config?.media_common_config
          .media_ustreamer_request_config?.video_playback_ustreamer_config;

      if (newUrl && newCfg) {
        stream.setStreamingURL(newUrl);
        stream.setUstreamerConfig(newCfg);
      }
    });

    const { videoStream, audioStream, selectedFormats } =
      await stream.start(opts);

    return {
      title,
      videoStream,
      audioStream,
      selectedFormats,
    };
  }
}
class DownloadCoordinator {
  constructor(
    private readonly sabrFactory: SabrStreamFactory,
    private readonly outputFiles: OutputFileFactory,
    private readonly sinks: StreamSinkFactory
  ) {}

  async download(
    videoId: string,
    opts: SabrPlaybackOptions,
    outputFolder: string,
    onProgress?: ProgressCallback
  ) {
    const { title, videoStream, audioStream, selectedFormats } =
      await this.sabrFactory.create(videoId, opts);

    const downloadQueue: Promise<void>[] = [];
    const outputs: { audio?: string; video?: string } = {};

    const wantsAudio =
      undefined === opts.enabledTrackTypes ||
      opts.enabledTrackTypes === EnabledTrackTypes.AUDIO_ONLY ||
      opts.enabledTrackTypes === EnabledTrackTypes.VIDEO_AND_AUDIO;

    const wantsVideo =
      undefined === opts.enabledTrackTypes ||
      opts.enabledTrackTypes === EnabledTrackTypes.VIDEO_ONLY ||
      opts.enabledTrackTypes === EnabledTrackTypes.VIDEO_AND_AUDIO;

    if (wantsAudio) {
      const output = this.outputFiles.create(
        "audio",
        selectedFormats.audioFormat.mimeType!,
        outputFolder
      );
      downloadQueue.push(
        audioStream.pipeTo(
          this.sinks.create(
            videoId,
            selectedFormats.audioFormat,
            output.stream,
            onProgress,
            "audio"
          )
        )
      );
      outputs.audio = output.filePath;
    }

    if (wantsVideo) {
      const output = this.outputFiles.create(
        "video",
        selectedFormats.videoFormat.mimeType!,
        outputFolder
      );
      downloadQueue.push(
        videoStream.pipeTo(
          this.sinks.create(
            videoId,
            selectedFormats.videoFormat,
            output.stream,
            onProgress,
            "video"
          )
        )
      );
      outputs.video = output.filePath;
    }

    await Promise.all(downloadQueue);

    return outputs;
  }
}

export declare interface DownloadOptions {
  audio: boolean;
  video: boolean;
}

export default async function YoutubeVideoDownloader(
  videoId: string,
  outputPath: string
) {
  const innertube = await Innertube.create({ cache: new UniversalCache(true) });
  const player = new PlayerRequestService(innertube);
  const webPo = new WebPoTokenService();
  const sabrFactory = new SabrStreamFactory(innertube, player, webPo);

  const coordinator = new DownloadCoordinator(
    sabrFactory,
    new OutputFileFactory(),
    new StreamSinkFactory()
  );

  return {
    videoId,
    async download(
      downloadOptions: DownloadOptions,
      onProgress?: ProgressCallback
    ) {
      const enabledTrackTypes: EnabledTrackTypes =
        downloadOptions.audio && !downloadOptions.video
          ? EnabledTrackTypes.AUDIO_ONLY
          : !downloadOptions.audio && downloadOptions.video
            ? EnabledTrackTypes.VIDEO_ONLY
            : EnabledTrackTypes.VIDEO_AND_AUDIO;

      const options: SabrPlaybackOptions = {
        preferWebM:
          enabledTrackTypes === EnabledTrackTypes.AUDIO_ONLY ||
          enabledTrackTypes === EnabledTrackTypes.VIDEO_AND_AUDIO
            ? true
            : undefined,
        preferOpus:
          enabledTrackTypes === EnabledTrackTypes.VIDEO_ONLY ||
          enabledTrackTypes === EnabledTrackTypes.VIDEO_AND_AUDIO
            ? true
            : undefined,
        enabledTrackTypes,
      };

      const paths = await coordinator.download(
        videoId,
        options,
        outputPath,
        onProgress
      );

      return {
        videoId,
        ...paths,
      };
    },
  };
}
