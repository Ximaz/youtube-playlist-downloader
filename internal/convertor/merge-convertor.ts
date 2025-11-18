import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";
import ffmpegRunner, {
  type FFmpegRunnerProgress,
} from "@internal/convertor/ffmpeg-runner";

export async function mergeToWEBM(
  audioPath: string,
  videoPath: string,
  outputPath: string,
  onProgress?: (progress: FFmpegRunnerProgress) => void,
): Promise<[string, Readable]> {
  await ffmpegRunner(
    [
      "-y",
      "-i",
      audioPath,
      "-i",
      videoPath,
      "-c:v",
      "copy",
      "-c:a",
      "copy",
      outputPath,
    ],
    onProgress,
  );

  const outputStream = createReadStream(outputPath);

  return [outputPath, outputStream];
}

export async function mergeToMPEG(
  audioPath: string,
  videoPath: string,
  outputPath: string,
  onProgress?: (progress: FFmpegRunnerProgress) => void,
): Promise<[string, Readable]> {
  await ffmpegRunner(
    [
      "-y",
      "-i",
      audioPath,
      "-i",
      videoPath,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      outputPath,
    ],
    onProgress,
  );

  const outputStream = createReadStream(outputPath);

  return [outputPath, outputStream];
}
