<template>
  <Select
    :default-value="model"
    :items="items"
    @change="
      (value: string) => {
        model = 'true' === value;
      }
    "
  />
</template>

<script setup lang="ts">
import Select from "./Select.vue";

const model = defineModel<boolean>({
  required: true,
});

const items = ref<{ label: string; value: boolean }[]>([
  { label: "Original (WEBA / WEBM)", value: false },
  { label: "Converted (M4A / MP4)", value: true },
]);
</script>
