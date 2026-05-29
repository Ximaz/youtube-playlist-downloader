<script setup lang="ts">
import { NButton, NInput, NInputGroup, NText } from 'naive-ui';
import { computed } from 'vue';

const urlInput = defineModel<string>('urlInput', { required: true });

defineProps<{
  loading: boolean;
}>();

const emit = defineEmits<{
  (e: 'load'): void;
}>();

const canLoad = computed(() => urlInput.value.trim().length > 0);

function onLoad(): void {
  if (canLoad.value) emit('load');
}
</script>

<template>
  <div>
    <n-input-group>
      <n-input
        v-model:value="urlInput"
        placeholder="Paste a YouTube playlist URL or id"
        clearable
        :disabled="loading"
        @keyup.enter="onLoad"
      />
      <n-button type="primary" :disabled="!canLoad" :loading="loading" @click="onLoad">
        Load
      </n-button>
    </n-input-group>
    <n-text depth="3" style="display: block; margin-top: 6px; font-size: 12px">
      Works with any public or unlisted playlist URL (or just the playlist id).
    </n-text>
  </div>
</template>
