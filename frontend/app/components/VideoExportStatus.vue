<template>
  <div v-if="!data" class="flex items-center gap-4 w-full px-4">
    <USkeleton v-if="!data" class="w-[228px] h-32" />
    <div class="flex flex-col gap-2 w-full">
      <USkeleton class="h-4 w-[250px]" />
      <USkeleton class="h-4 w-[200px]" />
    </div>
  </div>

  <div v-else class="flex items-center gap-4 w-full px-4">
    <img
      class="w-auto h-32 object-cover"
      :src="data.data!.thumbnailUrl"
      :alt="`Thumbnail of the video ${data.data!.title}`"
    />
    <div class="flex flex-col gap-2 w-full">
      <p class="w-full">
        {{ data.data!.title }}
      </p>
      <p class="w-full">
        {{ data.data!.author }}
      </p>
      <UProgress class="w-full" :model-value="progress" status />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { GenericAPIResponse } from "~/models/GenericAPIResponse";

const { videoId, steps, forceRefresh } = defineProps<{
  videoId: string;
  steps?: string[];
  forceRefresh: boolean;
}>();

const emit = defineEmits<{
  progress: [progress: number];
  error: [error: Error];
}>();

const { data, error } = useFetch<GenericAPIResponse<RefinedVideoMetadata>>(
  `/api/videos/${videoId}`,
  {
    query: { forceRefresh: forceRefresh ? "true" : "false" },
    key: `video-${videoId}-cache`,
    immediate: true,
  },
);

watch(
  error,
  (newError) => {
    if (undefined !== newError)
      emit("error", new Error(newError.message, { cause: newError.cause }));
  },
  { once: true },
);

const progress = ref<number>(0);

function updateProgress(newProgress: number, stepName?: string) {
  const progressValue = newProgress;
  const offset =
    undefined !== steps && undefined !== stepName ? steps.indexOf(stepName) : 0;
  const total = steps?.length ?? 1;

  progress.value = 100 * ((progressValue + offset) / total);
  emit("progress", progress.value);
}

defineExpose({
  videoId,
  progress,
  updateProgress,
});
</script>
