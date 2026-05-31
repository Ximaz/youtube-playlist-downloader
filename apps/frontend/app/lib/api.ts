import {
  type AuthMe,
  AuthMeSchema,
  type DownloadRequest,
  type DownloadResponse,
  DownloadResponseSchema,
  type OAuthPlaylist,
  OAuthPlaylistSchema,
  type OAuthPlaylistSummary,
  OAuthPlaylistSummarySchema,
  type PlaylistMetadata,
  PlaylistMetadataSchema,
  type VideoProgress,
  VideoProgressSchema,
  type WorkSelector,
} from '@ypd/shared';
import { z } from 'zod';

/** All backend calls go through the same-origin Nuxt BFF under `/api`. The browser never
 *  talks to the backend directly: Nitro proxies each request to the internal backend and
 *  swaps the httpOnly session cookie for a Bearer token. Same origin ⇒ no CORS. */
function backendBase(): string {
  return '/api';
}

/** Sign-in entry point — the BFF route redirects to Google consent, then sets the cookie. */
export function signInUrl(): string {
  return `${backendBase()}/auth/google`;
}

/** Per-endpoint timeouts (ms). Avoids the UI pinning loading flags on a stalled backend. */
const TIMEOUT = {
  authMe: 10_000,
  authPlaylists: 30_000,
  authPlaylist: 60_000,
  signOut: 5_000,
  publicPlaylist: 60_000,
  startDownload: 30_000,
  status: 15_000,
} as const;

/** Typed error so callers can branch on HTTP status (e.g. 404 = clear stale localStorage,
 *  5xx = surface as a transient banner and keep the entry). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  errorPrefix: string,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new ApiError(0, `${errorPrefix}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    // Body might be a `{error: {code, message}}` envelope (Phase 1 global filter) or empty.
    let detail = '';
    try {
      const body = await res.text();
      if (body) {
        try {
          const parsed = JSON.parse(body) as { error?: { message?: string } };
          detail = parsed.error?.message ?? body.slice(0, 200);
        } catch {
          detail = body.slice(0, 200);
        }
      }
    } catch {
      // Body already consumed or stream broken — keep `detail` empty.
    }
    throw new ApiError(res.status, `${errorPrefix} (${res.status})${detail ? ': ' + detail : ''}`);
  }
  return res;
}

async function parseJson<S extends z.ZodType>(res: Response, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await res.json();
  } catch (err) {
    throw new ApiError(0, `Malformed JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(0, `Backend contract violation: ${parsed.error.issues[0]?.message}`);
  }
  return parsed.data;
}

/** Cheap check; /auth/me always returns 200. */
export async function fetchMe(): Promise<AuthMe> {
  const res = await request(
    `${backendBase()}/auth/me`,
    { credentials: 'include' },
    TIMEOUT.authMe,
    'Failed to read sign-in state',
  );
  return parseJson(res, AuthMeSchema);
}

/** Returns null on 401 — the caller treats that as "session ended, sign in again". */
export async function fetchUserPlaylists(): Promise<OAuthPlaylistSummary[] | null> {
  try {
    const res = await request(
      `${backendBase()}/auth/playlists`,
      { credentials: 'include' },
      TIMEOUT.authPlaylists,
      'Failed to load your playlists',
    );
    return parseJson(res, z.array(OAuthPlaylistSummarySchema));
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/** Lazy-fetch one playlist's videoIds. Returns null on 401. */
export async function fetchUserPlaylist(id: string): Promise<OAuthPlaylist | null> {
  try {
    const res = await request(
      `${backendBase()}/auth/playlists/${encodeURIComponent(id)}`,
      { credentials: 'include' },
      TIMEOUT.authPlaylist,
      'Failed to load playlist',
    );
    return parseJson(res, OAuthPlaylistSchema);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export async function signOut(): Promise<void> {
  await request(
    `${backendBase()}/auth/sign-out`,
    { method: 'POST', credentials: 'include' },
    TIMEOUT.signOut,
    'Failed to sign out',
  );
}

export async function getPlaylist(id: string): Promise<PlaylistMetadata> {
  const res = await request(
    `${backendBase()}/playlists/${encodeURIComponent(id)}`,
    {},
    TIMEOUT.publicPlaylist,
    'Failed to load playlist',
  );
  return parseJson(res, PlaylistMetadataSchema);
}

export async function startDownload(req: DownloadRequest): Promise<DownloadResponse> {
  const res = await request(
    `${backendBase()}/downloads`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    },
    TIMEOUT.startDownload,
    'Failed to start download',
  );
  return parseJson(res, DownloadResponseSchema);
}

/** Resync: current state of each work item (used to repaint the UI on load / after refresh). */
export async function fetchStatus(req: WorkSelector): Promise<VideoProgress[]> {
  const res = await request(
    `${backendBase()}/downloads/status`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    },
    TIMEOUT.status,
    'Failed to fetch status',
  );
  return parseJson(res, z.array(VideoProgressSchema));
}

export function archiveUrl(batchId: string): string {
  return `${backendBase()}/downloads/${encodeURIComponent(batchId)}/archive`;
}

/** Extract a playlist id from a full URL (?list=...) or accept a raw id. */
export function parsePlaylistId(input: string): string {
  const trimmed = input.trim();
  try {
    const list = new URL(trimmed).searchParams.get('list');
    if (list) return list;
  } catch {
    // not a URL — fall through
  }
  return trimmed;
}

export const thumbnailUrl = (videoId: string): string =>
  `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

export const watchUrl = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}`;
