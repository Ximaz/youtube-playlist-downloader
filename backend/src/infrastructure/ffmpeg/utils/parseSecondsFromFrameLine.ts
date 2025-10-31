import convertTimeToSeconds from "./convertTimeToSeconds.js";

const FRAME_REGEX = /frame=.+time=(\d+):(\d+):(\d+)\.(\d+)/;

export default function parseSecondsFromFrameLine(
  frameLine: string,
): number | null {
  const frameMatch = FRAME_REGEX.exec(frameLine);
  if (!frameMatch) return null;
  return convertTimeToSeconds({
    hours: +frameMatch[1],
    minutes: +frameMatch[2],
    seconds: +frameMatch[3],
    milliseconds: +frameMatch[4],
  });
}
