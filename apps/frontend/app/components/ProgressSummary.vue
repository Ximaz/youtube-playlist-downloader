<script setup lang="ts">
import { NAlert, NCard, NProgress, NSpace, NTag, NText } from 'naive-ui';
import { computed } from 'vue';

import ArchiveLink from './ArchiveLink.vue';

const props = defineProps<{
  started: boolean;
  checking: boolean;
  total: number;
  queuedCount: number;
  downloadingCount: number;
  convertingCount: number;
  doneCount: number;
  cachedCount: number;
  failedCount: number;
  unavailableCount: number;
  /** null = not connected yet, false = disconnected, true = open. */
  wsConnected: boolean | null;
  archiveHref: string;
}>();

/** Terminal-of-total: cached + done + failed + unavailable. The % bar means "we are no
 *  longer working on this video", not "succeeded". */
const overallPct = computed(() => {
  if (props.total === 0) return 0;
  const terminal = props.doneCount + props.cachedCount + props.failedCount + props.unavailableCount;
  return Math.round((terminal / props.total) * 100);
});

interface Chip {
  label: string;
  type: 'default' | 'info' | 'success' | 'warning' | 'error';
}

const chips = computed<Chip[]>(() => {
  const out: Chip[] = [];
  if (props.queuedCount) out.push({ label: `Queued: ${props.queuedCount}`, type: 'default' });
  if (props.downloadingCount)
    out.push({ label: `Downloading: ${props.downloadingCount}`, type: 'info' });
  if (props.convertingCount)
    out.push({ label: `Converting: ${props.convertingCount}`, type: 'info' });
  if (props.doneCount) out.push({ label: `Ready: ${props.doneCount}`, type: 'success' });
  if (props.cachedCount) out.push({ label: `Cached: ${props.cachedCount}`, type: 'info' });
  if (props.failedCount) out.push({ label: `Failed: ${props.failedCount}`, type: 'error' });
  if (props.unavailableCount)
    out.push({ label: `Unavailable: ${props.unavailableCount}`, type: 'warning' });
  return out;
});
</script>

<template>
  <n-card size="small" :bordered="true">
    <n-space vertical :size="16">
      <div>
        <n-space justify="space-between" align="center" style="margin-bottom: 8px">
          <n-text>Progress</n-text>
          <n-text depth="3" style="font-size: 12px">
            <template v-if="checking">Checking availability…</template>
            <template v-else>{{ overallPct }}% complete</template>
          </n-text>
        </n-space>
        <n-progress
          type="line"
          :percentage="overallPct"
          :show-indicator="false"
          :height="10"
          :border-radius="5"
        />
      </div>

      <n-space v-if="chips.length" :size="8">
        <n-tag v-for="(chip, i) in chips" :key="i" :type="chip.type" size="small" round>
          {{ chip.label }}
        </n-tag>
      </n-space>

      <n-alert
        v-if="started && wsConnected === false"
        type="info"
        :show-icon="true"
        :closable="false"
        title="Live updates paused"
      >
        Reconnecting to the server…
      </n-alert>

      <ArchiveLink :href="archiveHref" />
    </n-space>
  </n-card>
</template>
