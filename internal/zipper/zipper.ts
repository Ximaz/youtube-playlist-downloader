import path from "node:path";
import { Readable } from "node:stream";
import archiver from "archiver";
import type { StoragePath } from "@internal/storage/storage";
import type YoutubeArtifactManager from "@internal/youtube-artifact-manager";
import type { RefinedVideoMetadata } from "@internal/youtube-api/video-typings";

export interface ZipperProgress {
  total: number;
  processed: number;
}

export default class Zipper {
  constructor(
    private readonly youtubeArtifactManager: YoutubeArtifactManager,
  ) {}

  async *generateArchive(
    videoIds: string[],
    options: { audio: boolean; video: boolean; convert: boolean },
  ): AsyncGenerator<Uint8Array> {
    const archive = archiver("zip", { zlib: { level: 9 } });

    // Pipe archive data into a Readable that yields chunks
    const readable = Readable.from(
      (async function* () {
        for await (const chunk of archive) {
          const bytes = new Uint8Array(
            (chunk as Buffer).buffer,
            (chunk as Buffer).byteOffset,
            (chunk as Buffer).byteLength,
          );
          yield bytes;
        }
      })(),
    );

    const streams = await this.youtubeArtifactManager.pullVideosStreams(
      videoIds,
      options,
    );

    for (const { stream, metadata, path: filepath } of streams as {
      stream: Readable;
      metadata: RefinedVideoMetadata;
      path: StoragePath;
    }[]) {
      const filename = `${metadata.title}${path.extname(filepath.filename)}`;
      archive.append(stream, {
        name: path.join("/", "youtube-videos/", filename),
      });
    }

    void archive.finalize();

    for await (const chunk of readable) {
      yield chunk;
    }
  }
}
