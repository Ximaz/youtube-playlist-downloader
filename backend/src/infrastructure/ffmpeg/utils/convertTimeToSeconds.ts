export default function convertTimeToSeconds({
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
