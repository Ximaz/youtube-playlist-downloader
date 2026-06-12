import type { PlaylistMetadata } from '@ypd/shared';
import { ref } from 'vue';

import { getPlaylist, parsePlaylistId } from '../lib/api';
import { parseVideoUrls } from '../lib/urls';

/** Which manual entry path is active: a single playlist URL, or a pasted blob of
 *  individual video URLs turned into an ad-hoc playlist. */
export type PlaylistSourceMode = 'playlist' | 'paste';

/** Source of the current playlist (URL-paste path). The OAuth picker path uses
 *  setPlaylist() directly so the two flows share the same downstream rendering.
 *
 *  Independent last-write-wins token from useAuth — picking a personal playlist and
 *  pasting a URL are two distinct invalidation tracks. */
export function usePlaylistSource() {
  const mode = ref<PlaylistSourceMode>('playlist');
  const urlInput = ref('');
  const urlsInput = ref('');
  const playlist = ref<PlaylistMetadata | null>(null);
  const loading = ref(false);

  let pickToken = 0;
  let pickAbort: AbortController | null = null;
  function nextPickToken(): number {
    pickAbort?.abort();
    pickAbort = new AbortController();
    return ++pickToken;
  }

  /** Returns true on success, false if the request was superseded (silent drop). */
  async function loadFromUrl(): Promise<boolean> {
    const token = nextPickToken();
    playlist.value = null;
    loading.value = true;
    try {
      const meta = await getPlaylist(parsePlaylistId(urlInput.value));
      if (token !== pickToken) return false;
      playlist.value = meta;
      return true;
    } finally {
      if (token === pickToken) loading.value = false;
    }
  }

  /** Build an ad-hoc playlist from the pasted-URLs textarea. Synchronous — no backend
   *  round-trip, the backend resolves each id at download time. Returns `ok: false` when
   *  no line yields a video id; `skipped` is the count of unrecognized lines so the
   *  caller can surface "N skipped". */
  function buildFromUrls(): { ok: boolean; skipped: number } {
    pickAbort?.abort(); // cancel any in-flight playlist-URL fetch — this supersedes it.
    const { ids, skipped } = parseVideoUrls(urlsInput.value);
    if (ids.length === 0) {
      playlist.value = null;
      return { ok: false, skipped };
    }
    playlist.value = { id: 'pasted', title: 'Pasted URLs', videos: ids.map((id) => ({ id })) };
    return { ok: true, skipped };
  }

  function setPlaylist(p: PlaylistMetadata | null): void {
    playlist.value = p;
  }

  function clear(): void {
    pickAbort?.abort();
    pickAbort = null;
    playlist.value = null;
    urlInput.value = '';
    urlsInput.value = '';
  }

  return {
    mode,
    urlInput,
    urlsInput,
    playlist,
    loading,
    loadFromUrl,
    buildFromUrls,
    setPlaylist,
    clear,
  };
}

export type UsePlaylistSource = ReturnType<typeof usePlaylistSource>;
