import type { MediaSelection, OutputFormat } from '@ypd/shared';

/** Two independent worker pools: downloads (provider -> S3) and ffmpeg conversions.
 *  Splitting them lets converted/merged batches run download + convert concurrently. */
export const DOWNLOAD_QUEUE = 'download';
export const CONVERT_QUEUE = 'convert';

export const JOB_DOWNLOAD_VIDEO = 'download-video';
export const JOB_CONVERT_VIDEO = 'convert-video';

export interface DownloadVideoJobData {
  videoId: string;
  selection: MediaSelection;
  format: OutputFormat;
}

/** An original already streamed to S3 by the download stage. */
export interface ConvertSource {
  key: string;
  ext: string;
}

export interface ConvertVideoJobData {
  videoId: string;
  selection: MediaSelection;
  format: OutputFormat;
  /** S3 keys of the originals the convert stage must pull back to mux/transcode. */
  sources: { video?: ConvertSource; audio?: ConvertSource };
}
