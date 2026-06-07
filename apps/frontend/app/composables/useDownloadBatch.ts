import type { MediaSelection, OutputFormat, VideoProgress } from '@ypd/shared';
import { computed, onScopeDispose, ref, shallowRef } from 'vue';

import { archiveUrl, fetchStatus, startDownload } from '../lib/api';
import { connectSocket, type TypedSocket } from '../lib/socket';

/** Owns the live download batch: configuration (selection/format), runtime flags,
 *  the per-video progress map, the socket lifecycle and all derived counts.
 *
 *  `progress` is a `shallowRef` because the map is hot (one event per progress tick
 *  across N videos). The root reactivity fires on each reassignment exactly once;
 *  paired with `v-memo` on the row, this keeps a 200-video list fluid.
 *  ⚠️  Always REASSIGN (`progress.value = { ...progress.value, [id]: msg }`) —
 *      a nested mutation (`progress.value[id] = msg`) is invisible to shallowRef.
 *
 *  effectScope() is not used: the composable holds at most one `watch` and the socket
 *  is torn down via the explicit teardown() + onScopeDispose. Add an effectScope if a
 *  future watch needs to share lifetime with a sibling. */
export function useDownloadBatch() {
  // Spec defaults (§6.4): the console's segmented controls start on Combined + Converted.
  const selection = ref<MediaSelection>('merged');
  const format = ref<OutputFormat>('converted');

  const started = ref(false);
  const checking = ref(false);
  const batchId = ref<string | null>(null);
  const progress = shallowRef<Record<string, VideoProgress>>({});
  /** null = no connection attempted yet, false = disconnected/reconnecting, true = open. */
  const wsConnected = ref<boolean | null>(null);

  let socket: TypedSocket | null = null;

  function teardownSocket(): void {
    if (!socket) return;
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    wsConnected.value = null;
  }

  // Counts — each its own computed so they invalidate independently.
  const countStep = (...wanted: VideoProgress['step'][]): number =>
    Object.values(progress.value).filter((p) => wanted.includes(p.step)).length;

  const queuedCount = computed(() => countStep('queued'));
  const downloadingCount = computed(() => countStep('download'));
  const convertingCount = computed(() => countStep('convert'));
  const doneCount = computed(() => countStep('done'));
  const cachedCount = computed(() => countStep('cached'));
  const failedCount = computed(() => countStep('failed'));
  const unavailableCount = computed(() => countStep('unavailable'));
  const terminalCount = computed(
    () => doneCount.value + cachedCount.value + failedCount.value + unavailableCount.value,
  );
  const total = computed(() => Object.keys(progress.value).length);
  /** Successful-only terminals — drives the archive availability check. */
  const successCount = computed(() => doneCount.value + cachedCount.value);
  const allTerminal = computed(
    () => started.value && total.value > 0 && terminalCount.value >= total.value,
  );
  const pending = computed(() => started.value && !checking.value && !allTerminal.value);
  /** Available once the batch is fully settled (no task still running) AND at least one
   *  video succeeded — failed/unavailable entries are simply left out of the zip. The
   *  backend applies the same rule (409 only while work is pending, 404 if nothing
   *  succeeded), so a visible link always resolves to a real archive. */
  const archiveHref = computed(() =>
    batchId.value && allTerminal.value && successCount.value > 0 ? archiveUrl(batchId.value) : '',
  );

  function subscribe(videoIds: string[], sel: MediaSelection, fmt: OutputFormat): void {
    teardownSocket();
    socket = connectSocket();
    socket.on('connect', () => {
      wsConnected.value = true;
      socket?.emit('subscribe', { videoIds, selection: sel, format: fmt });
    });
    // socket.io auto-reconnects; flip the flag so the UI shows a reconnection banner.
    socket.on('disconnect', () => {
      wsConnected.value = false;
    });
    socket.on('connect_error', (err) => {
      wsConnected.value = false;
      console.warn('WebSocket connect_error (retrying):', err.message);
    });
    socket.on('video:progress', (msg) => {
      // Reassign — shallowRef would miss `progress.value[msg.videoId] = msg`.
      progress.value = { ...progress.value, [msg.videoId]: msg };
    });
  }

  /** Start a new batch for the given videoIds. Throws on network failure;
   *  the caller decides how to surface it (toast/banner). */
  async function start(videoIds: string[]): Promise<void> {
    const sel = selection.value;
    const fmt = format.value;
    started.value = true;
    checking.value = true;
    // Seed every video as queued so the list shows a state while the probe runs.
    const seeded: Record<string, VideoProgress> = {};
    for (const id of videoIds) {
      seeded[id] = { videoId: id, selection: sel, format: fmt, step: 'queued' };
    }
    progress.value = seeded;
    try {
      // Send videoIds we actually rendered, not the playlistId — the OAuth picker filters
      // out private/blocked entries client-side; the backend's playlist resolution returns
      // the unfiltered list. Mixing the two views inflates progress with a phantom entry.
      const res = await startDownload({ videoIds, selection: sel, format: fmt });
      checking.value = false;
      batchId.value = res.batchId;
      const next: Record<string, VideoProgress> = { ...progress.value };
      for (const id of res.unavailable) {
        // Defensive: only mark videos already in the user's view.
        if (id in next) {
          next[id] = { videoId: id, selection: sel, format: fmt, step: 'unavailable' };
        }
      }
      const states = await fetchStatus({ videoIds: res.videoIds, selection: sel, format: fmt });
      for (const s of states) next[s.videoId] = s;
      progress.value = next;
      subscribe(res.videoIds, sel, fmt);
    } catch (err) {
      checking.value = false;
      started.value = false;
      throw err;
    }
  }

  function reset(): void {
    started.value = false;
    checking.value = false;
    batchId.value = null;
    progress.value = {};
    teardownSocket();
  }

  // HMR / parent unmount: kill the socket without each consumer wiring onUnmounted.
  onScopeDispose(() => {
    teardownSocket();
  });

  return {
    selection,
    format,
    started,
    checking,
    batchId,
    progress,
    wsConnected,
    queuedCount,
    downloadingCount,
    convertingCount,
    doneCount,
    cachedCount,
    failedCount,
    unavailableCount,
    terminalCount,
    successCount,
    total,
    allTerminal,
    pending,
    archiveHref,
    start,
    reset,
    teardown: teardownSocket,
  };
}

export type UseDownloadBatch = ReturnType<typeof useDownloadBatch>;
