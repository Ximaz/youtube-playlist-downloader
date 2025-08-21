import path from "node:path";
import { Readable } from "node:stream";
import archiver from "archiver";
import type CommunicationService from "@/services/CommunicationService.js";
import type YoutubeArtifactPublisherService from "@/services/YoutubeArtifactPublisherService.js";
import type { VideosExportDto } from "@/models/videos.js";
import type { YoutubeArtifactMetadata } from "@/services/YoutubeArtifactPublisherService.js";
import type { StorageServicePath } from "@/services/StorageService.js";

export default class CompressVideosService {
  constructor(
    private readonly youtubeArtifactPublisherService: YoutubeArtifactPublisherService,
    private readonly communicationService?: CommunicationService,
  ) {}

  async *generateArchive(params: VideosExportDto): AsyncGenerator<Uint8Array> {
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

    // Optional progress reporting
    archive.on("progress", ({ entries }) => {
      this.communicationService?.sendCompressProgress({
        type: "COMPRESS",
        total: entries.total,
        processed: entries.processed,
      });
    });

    const streams =
      await this.youtubeArtifactPublisherService.pullVideosStreams(
        params.videoIds,
        {
          audio: params.audio,
          video: params.video,
          convert: params.convert,
        },
      );

    // Append streams
    for (const { stream, metadata, path: filepath } of streams as {
      stream: Readable;
      metadata: YoutubeArtifactMetadata;
      path: StorageServicePath;
    }[]) {
      const filename = `${metadata.title}${path.extname(filepath.filename)}`;
      archive.append(stream, {
        name: path.join("/", "youtube-videos/", filename),
        date: metadata.date,
      });
    }

    // finalize triggers archiver to start emitting chunks
    void archive.finalize();

    // Yield chunks as they come from the archive
    for await (const chunk of readable) {
      yield chunk;
    }
  }
}
