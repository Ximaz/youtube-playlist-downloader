import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";
import type { RefinedVideoMetadata } from "@internal/youtube-api/video-typings";
import ffmpegRunner, {
  type FFmpegRunnerProgress,
} from "@internal/convertor/ffmpeg-runner";

export default async function audioConvertor(
  inputPath: string,
  outputPath: string,
  onProgress?: (progress: FFmpegRunnerProgress) => void,
  opts?: {
    thumbnailPath?: string;
    metadata?: RefinedVideoMetadata;
  },
): Promise<[string, Readable]> {
  const ffmepgOpts: string[] = [];

  if (undefined !== opts) {
    if (undefined !== opts.thumbnailPath)
      ffmepgOpts.push(
        "-i",
        opts.thumbnailPath,
        "-map",
        "0:a",
        "-map",
        "1:0",
        "-c:v",
        "png",
        "-disposition:v:0",
        "attached_pic",
      );

    if (undefined !== opts.metadata) {
      const mappedMetadata = {
        artist: opts.metadata.author,
        title: opts.metadata.title,
      };
      for (const [k, v] of Object.entries(mappedMetadata))
        ffmepgOpts.push("-metadata", `${k}=${v}`);
    }
  }

  const ffmpegOptions = [
    "-y",
    "-i",
    inputPath,
    ...ffmepgOpts,
    "-c:a",
    "aac",
    outputPath,
  ];

  await ffmpegRunner(ffmpegOptions, onProgress);

  const outputStream = createReadStream(outputPath);

  return [outputPath, outputStream];
}
