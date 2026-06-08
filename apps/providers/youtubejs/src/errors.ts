export type ProviderErrorCode =
  | 'BAD_REQUEST'
  | 'VIDEO_NOT_FOUND'
  | 'PLAYLIST_NOT_FOUND'
  | 'FORMAT_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR';

/** Maps onto the contract envelope: `{ "error": { code, message } }`. `retryAfterSeconds`,
 *  when set (RATE_LIMITED), is rendered as the `Retry-After` header so the backend honours it. */
export class ProviderError extends Error {
  constructor(
    readonly status: number,
    readonly code: ProviderErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
