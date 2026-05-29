export type ProviderErrorCode =
  | 'BAD_REQUEST'
  | 'VIDEO_NOT_FOUND'
  | 'PLAYLIST_NOT_FOUND'
  | 'FORMAT_NOT_FOUND'
  | 'UPSTREAM_ERROR';

/** Maps onto the contract envelope: `{ "error": { code, message } }`. */
export class ProviderError extends Error {
  constructor(
    readonly status: number,
    readonly code: ProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
