<script setup lang="ts">
const props = defineProps<{
  title: string;
  description: string;
  open: boolean;
}>();
const emitter = defineEmits<{ close: [boolean] }>();
</script>

<template>
  <UModal
    :open="props.open"
    :close="{ onClick: () => emitter('close', true) }"
    :title="props.title"
    :description="props.description"
  >
    <template #footer>
      <UButton color="neutral" label="Ok" @click="emitter('close', true)" />
    </template>
  </UModal>
</template>
