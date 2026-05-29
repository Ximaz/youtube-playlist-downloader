<script setup lang="ts">
import type { MediaSelection, OutputFormat } from '@ypd/shared';
import { NButton, NCard, NFormItem, NRadio, NRadioGroup, NSpace, NText } from 'naive-ui';
import { computed } from 'vue';

const selection = defineModel<MediaSelection>('selection', { required: true });
const format = defineModel<OutputFormat>('format', { required: true });

const props = defineProps<{
  /** Disable interaction while a request is in flight. */
  disabled: boolean;
  /** Probe phase (POST /downloads). */
  checking: boolean;
  /** Downloads in flight (between checking and allTerminal). */
  pending: boolean;
}>();

defineEmits<{
  (e: 'download'): void;
}>();

/** Resulting file extension for the chosen combination, surfaced as a small hint line
 *  so the difference between Original and Converted is concrete. */
const extHint = computed(() => {
  const s = selection.value;
  const f = format.value;
  if (s === 'audio') return f === 'original' ? '.weba (opus)' : '.m4a (aac + cover art)';
  if (s === 'video') return f === 'original' ? '.webm (vp9, no audio)' : '.mp4 (h264, no audio)';
  return f === 'original' ? '.webm (vp9 + opus, no re-encode)' : '.mp4 (h264 + aac)';
});

const buttonText = computed(() => {
  if (props.checking) return 'Checking availability…';
  if (props.pending) return 'Downloading…';
  return 'Download';
});
</script>

<template>
  <n-card title="Output options" size="small" :bordered="true">
    <n-space vertical :size="16">
      <n-form-item label="Selection" :show-feedback="false">
        <n-radio-group v-model:value="selection" :disabled="disabled">
          <n-radio value="audio">Audio only</n-radio>
          <n-radio value="video">Video only</n-radio>
          <n-radio value="merged">Audio + Video</n-radio>
        </n-radio-group>
      </n-form-item>

      <n-form-item label="Format" :show-feedback="false">
        <n-radio-group v-model:value="format" :disabled="disabled">
          <n-radio value="original">Original</n-radio>
          <n-radio value="converted">Converted</n-radio>
        </n-radio-group>
      </n-form-item>

      <n-text depth="3" style="font-size: 12px">Output file: {{ extHint }}</n-text>

      <n-button
        type="primary"
        size="large"
        block
        :loading="checking || pending"
        :disabled="disabled || checking || pending"
        @click="$emit('download')"
      >
        {{ buttonText }}
      </n-button>
    </n-space>
  </n-card>
</template>
