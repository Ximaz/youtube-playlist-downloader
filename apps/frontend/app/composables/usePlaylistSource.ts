import type { PlaylistMetadata } from '@ypd/shared';
import { ref } from 'vue';

import { getPlaylist, parsePlaylistId } from '../lib/api';

/** Source of the current playlist (URL-paste path). The OAuth picker path uses
 *  setPlaylist() directly so the two flows share the same downstream rendering.
 *
 *  Independent last-write-wins token from useAuth — picking a personal playlist and
 *  pasting a URL are two distinct invalidation tracks. */
export function usePlaylistSource() {
  const urlInput = ref('');
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

  function setPlaylist(p: PlaylistMetadata | null): void {
    playlist.value = p;
  }

  function clear(): void {
    pickAbort?.abort();
    pickAbort = null;
    playlist.value = null;
    urlInput.value = '';
  }

  return {
    urlInput,
    playlist,
    loading,
    loadFromUrl,
    setPlaylist,
    clear,
  };
}

export type UsePlaylistSource = ReturnType<typeof usePlaylistSource>;
