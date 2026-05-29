import type { MediaSelection, OutputFormat } from '@ypd/shared';

export interface Deliverable {
  key: string;
  ext: string;
}

export type MediaKind = 'audio' | 'video';

/** S3 key for a downloaded original stream. */
export function originalKey(videoId: string, kind: MediaKind, ext: string): string {
  return `${videoId}.src.${kind}.${ext}`;
}

/** Whether the deliverable requires an ffmpeg post-process (convert/mux) after download.
 *  `merged` always muxes; `converted` always transcodes; plain originals never do. */
export function needsFfmpeg(selection: MediaSelection, format: OutputFormat): boolean {
  return selection === 'merged' || format === 'converted';
}

/** Original media tracks the download stage must fetch for a request. */
export function requiredKinds(selection: MediaSelection): MediaKind[] {
  return selection === 'merged' ? ['video', 'audio'] : [selection];
}

/**
 * The deterministic deliverable for converted/merged requests. Returns null for
 * `original` audio/video, whose extension is only known after streaming.
 */
export function fixedDeliverable(
  videoId: string,
  selection: MediaSelection,
  format: OutputFormat,
): Deliverable | null {
  if (selection === 'merged') {
    return format === 'converted'
      ? { key: `${videoId}.merged.mp4`, ext: 'mp4' }
      : { key: `${videoId}.merged.webm`, ext: 'webm' };
  }
  if (format === 'converted') {
    const ext = selection === 'audio' ? 'm4a' : 'mp4';
    return { key: `${videoId}.cvt.${selection}.${ext}`, ext };
  }
  return null;
}

/**
 * Every S3 key that could already satisfy this request — used to pre-filter cached
 * videos. For `original` audio/video both possible extensions are checked.
 *
 * Special case: `merged + original` can land as either `.webm` (vp9 + opus, the
 * preferred no-re-encode path) or `.mkv` (matroska fallback when YouTube only
 * has h264/aac available — webm container rejects those codecs). Both keys are
 * checked so a previous run's output is still recognised as cached.
 */
export function deliverableCandidates(
  videoId: string,
  selection: MediaSelection,
  format: OutputFormat,
): Deliverable[] {
  if (selection === 'merged' && format === 'original') {
    return [
      { key: `${videoId}.merged.webm`, ext: 'webm' },
      { key: `${videoId}.merged.mkv`, ext: 'mkv' },
    ];
  }
  const fixed = fixedDeliverable(videoId, selection, format);
  if (fixed) return [fixed];
  return selection === 'audio'
    ? [
        { key: originalKey(videoId, 'audio', 'weba'), ext: 'weba' },
        { key: originalKey(videoId, 'audio', 'm4a'), ext: 'm4a' },
      ]
    : [
        { key: originalKey(videoId, 'video', 'webm'), ext: 'webm' },
        { key: originalKey(videoId, 'video', 'mp4'), ext: 'mp4' },
      ];
}

/** Output container for the merged-original mux based on the actual source extensions.
 *  webm only accepts vp8/vp9/av1 video and vorbis/opus audio — anything else lands in
 *  a matroska (.mkv) container instead, also with `-c copy` (still no re-encode).
 *  Chosen over `.mp4` because matroska accepts ANY codec combo, so we never have to
 *  decide between re-encoding and rejecting; the trade-off is that mkv playback
 *  typically needs VLC/MPV (browser playback isn't a goal of the "original" path). */
export function mergedOriginalDeliverable(
  videoId: string,
  videoExt: string | undefined,
  audioExt: string | undefined,
): Deliverable {
  const webmCompatible = videoExt === 'webm' && audioExt === 'weba';
  return webmCompatible
    ? { key: `${videoId}.merged.webm`, ext: 'webm' }
    : { key: `${videoId}.merged.mkv`, ext: 'mkv' };
}
