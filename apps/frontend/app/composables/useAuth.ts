import type { OAuthPlaylist, OAuthPlaylistSummary } from '@ypd/shared';
import { ref } from 'vue';

import { fetchMe, fetchUserPlaylist, fetchUserPlaylists, signOut } from '../lib/api';

/** Auth + OAuth playlist picker state.
 *
 *  Last-write-wins: rapidly switching playlists in the picker must not let a slow
 *  earlier fetch overwrite a fresh one. Each resolvePlaylist call captures its own
 *  token before the first await; later steps bail out silently if they're not the
 *  current one. An AbortController also cancels the in-flight fetch. */
export function useAuth() {
  /** null = unknown (initial /auth/me in flight), then boolean. */
  const signedIn = ref<boolean | null>(null);
  const userPlaylists = ref<OAuthPlaylistSummary[] | null>(null);
  const loadingPlaylists = ref(false);
  /** Which summary row is currently resolving its videoIds — used to disable the row. */
  const loadingPlaylistId = ref<string | null>(null);

  let pickToken = 0;
  let pickAbort: AbortController | null = null;
  function nextPickToken(): number {
    pickAbort?.abort();
    pickAbort = new AbortController();
    return ++pickToken;
  }

  async function init(): Promise<void> {
    const me = await fetchMe();
    signedIn.value = me.signedIn;
    if (me.signedIn) await loadUserPlaylists();
  }

  async function loadUserPlaylists(): Promise<void> {
    loadingPlaylists.value = true;
    try {
      const list = await fetchUserPlaylists();
      if (list === null) {
        signedIn.value = false;
        userPlaylists.value = null;
        return;
      }
      userPlaylists.value = list;
    } finally {
      loadingPlaylists.value = false;
    }
  }

  /** Returns the resolved playlist, or null if the request was superseded or the
   *  session expired server-side (caller flips back to the signed-out picker). */
  async function resolvePlaylist(p: OAuthPlaylistSummary): Promise<OAuthPlaylist | null> {
    const token = nextPickToken();
    loadingPlaylistId.value = p.id;
    try {
      const full = await fetchUserPlaylist(p.id);
      if (token !== pickToken) return null;
      if (full === null) {
        signedIn.value = false;
        userPlaylists.value = null;
        return null;
      }
      return full;
    } finally {
      if (token === pickToken) loadingPlaylistId.value = null;
    }
  }

  async function signOutSession(): Promise<void> {
    await signOut();
    signedIn.value = false;
    userPlaylists.value = null;
  }

  return {
    signedIn,
    userPlaylists,
    loadingPlaylists,
    loadingPlaylistId,
    init,
    loadUserPlaylists,
    resolvePlaylist,
    signOut: signOutSession,
  };
}

export type UseAuth = ReturnType<typeof useAuth>;
