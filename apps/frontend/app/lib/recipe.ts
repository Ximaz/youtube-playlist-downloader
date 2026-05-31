import type { MediaSelection, OutputFormat } from '@ypd/shared';

/** Output file extension for a selection+format pair — the spec's §6.5 table
 *  (`audio` → weba/m4a, `video`/`merged` → webm/mp4). Shared by the Output control's
 *  container labels, the queue meta line and each row's tag. */
export function outputExt(selection: MediaSelection, format: OutputFormat): string {
  if (selection === 'audio') return format === 'converted' ? 'm4a' : 'weba';
  return format === 'converted' ? 'mp4' : 'webm'; // video | merged share webm/mp4
}

/** Uppercase container name shown in the Output segmented control's `<em>`. */
export function containerLabel(selection: MediaSelection, format: OutputFormat): string {
  return outputExt(selection, format).toUpperCase();
}
