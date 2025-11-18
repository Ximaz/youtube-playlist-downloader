import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";
import ffmpegRunner, {
  type FFmpegRunnerProgress,
} from "@internal/convertor/ffmpeg-runner";

export default async function videoConvertor(
  inputPath: string,
  outputPath: string,
  onProgress?: (progress: FFmpegRunnerProgress) => void,
): Promise<[string, Readable]> {
  await ffmpegRunner(
    [
      "-y",
      "-i",
      inputPath,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      outputPath,
    ],
    onProgress,
  );

  const outputStream = createReadStream(outputPath);

  return [outputPath, outputStream];
}
