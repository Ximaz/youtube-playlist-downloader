import { execFile } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import parseSecondsFromDurationLine from "../utils/parseSecondsFromDurationLine.js";
import parseSecondsFromFrameLine from "../utils/parseSecondsFromFrameLine.js";

export default function runner(
  args: string[],
  onProgress?: (progress: { total: number; processed: number }) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let duration: number | null = null; // in seconds

    execFile(ffmpegPath as unknown as string, args, (error: Error | null) => {
      if (null === error) {
        resolve();
      } else {
        reject(error);
      }
    }).stderr?.on("data", (chunk) => {
      if (null === duration) {
        duration = parseSecondsFromDurationLine(chunk as string);
        return void 0;
      }

      const frame = parseSecondsFromFrameLine(chunk as string);
      if (null === frame) return void 0;

      onProgress?.({ total: duration, processed: frame });
    });
  });
}
