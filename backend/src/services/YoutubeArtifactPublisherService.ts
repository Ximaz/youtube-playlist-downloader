import path from "node:path";
import { Readable } from "node:stream";
import type {
  StorageService,
  StorageServicePath,
} from "@/services/StorageService.js";

export interface YoutubeArtifactMetadata extends Record<string, string> {
  title: string;
  author: string;
  date: string;
  thumbnail_url: string;
}

export default class YoutubeArtifactPublisherService {
  constructor(private readonly storageProviderService: StorageService) {}

  private static computeVideoPath(
    videoId: string,
    {
      audio,
      video,
      convert,
    }: { audio: boolean; video: boolean; convert: boolean },
  ): StorageServicePath {
    const parent = convert ? "media-processed" : "media-raw";
    const kind =
      audio && !video ? "audio" : !audio && video ? "video" : "merged";
    const fileExtension = convert
      ? audio && !video
        ? "m4a"
        : "mp4"
      : audio && !video
        ? "weba"
        : "webm";

    return {
      parent: path.join(parent, videoId, kind),
      filename: `${videoId}.${fileExtension}`,
    };
  }

  async pushStream(
    videoId: string,
    stream: Readable,
    metadata: RefinedVideoMetadata,
    contentType: string,
    streamOpts: { audio: boolean; video: boolean; convert: boolean },
  ) {
    const path = YoutubeArtifactPublisherService.computeVideoPath(
      videoId,
      streamOpts,
    );

    return await this.storageProviderService.pushMultipart(
      path,
      stream,
      contentType,
      metadata,
    );
  }

  async streamExists(
    videoId: string,
    streamOpts: { audio: boolean; video: boolean; convert: boolean },
  ) {
    const path = YoutubeArtifactPublisherService.computeVideoPath(
      videoId,
      streamOpts,
    );

    return undefined !== (await this.storageProviderService.head(path));
  }

  async pullStream(
    videoId: string,
    streamOpts: { audio: boolean; video: boolean; convert: boolean },
  ) {
    const path = YoutubeArtifactPublisherService.computeVideoPath(
      videoId,
      streamOpts,
    );

    return await this.storageProviderService.pull(path);
  }

  async pullVideosStreams(
    videoIds: string[],
    streamOpts: {
      audio: boolean;
      video: boolean;
      convert: boolean;
    },
  ) {
    return await Promise.all(
      videoIds.map((videoId) => this.pullStream(videoId, streamOpts)),
    );
  }
}
