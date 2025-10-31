import convertTimeToSeconds from "./convertTimeToSeconds.js";

// This regex is applied over a string that contains multiple lines, thus it
// requires the 'm' modifier for multiline matching.
const DURATION_REGEX =
  /^(?:(?:\s+)?Duration:(?:\s+)?)?(\d+):(\d+):(\d+)\.(\d+)/m;

export default function parseSecondsFromDurationLine(durationLine: string) {
  const durationMatch = DURATION_REGEX.exec(durationLine);
  if (!durationMatch) return null;
  return convertTimeToSeconds({
    hours: +durationMatch[1],
    minutes: +durationMatch[2],
    seconds: +durationMatch[3],
    milliseconds: +durationMatch[4],
  });
}
