import { execFile } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

export interface FFmpegRunnerProgress {
  total: number;
  processed: number;
}

// This regex is applied over a string that contains multiple lines, thus it
// requires the 'm' modifier for multiline matching.
const DURATION_REGEX =
  /^(?:(?:\s+)?Duration:(?:\s+)?)?(\d+):(\d+):(\d+)\.(\d+)/m;

const FRAME_REGEX = /frame=.+time=(\d+):(\d+):(\d+)\.(\d+)/;

function convertTimeToSeconds({
  hours,
  minutes,
  seconds,
  milliseconds,
}: {
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
}) {
  return hours * 60 * 60 + minutes * 60 + seconds + milliseconds / 100;
}

function parseSecondsFromDurationLine(durationLine: string) {
  const durationMatch = DURATION_REGEX.exec(durationLine);
  if (!durationMatch) return null;
  return convertTimeToSeconds({
    hours: +durationMatch[1]!,
    minutes: +durationMatch[2]!,
    seconds: +durationMatch[3]!,
    milliseconds: +durationMatch[4]!,
  });
}

function parseSecondsFromFrameLine(frameLine: string): number | null {
  const frameMatch = FRAME_REGEX.exec(frameLine);
  if (!frameMatch) return null;
  return convertTimeToSeconds({
    hours: +frameMatch[1]!,
    minutes: +frameMatch[2]!,
    seconds: +frameMatch[3]!,
    milliseconds: +frameMatch[4]!,
  });
}

export default function ffmpegRunner(
  args: string[],
  onProgress?: (progress: FFmpegRunnerProgress) => void,
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
