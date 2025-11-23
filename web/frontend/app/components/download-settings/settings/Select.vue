<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <select
    class="select"
    @change="
      (e) =>
        emitter('change', (e.target! as unknown as { value: string }).value)
    "
  >
    <option
      v-for="item in props.items"
      :key="item.label"
      :selected="defaultValue === item.value"
      :value="item.value"
    >
      {{ item.label }}
    </option>
  </select>
</template>

<script setup lang="ts">
const props = defineProps<{
  items: { label: string; value: unknown }[];
  defaultValue: unknown;
}>();

const emitter = defineEmits<{ change: [value: string] }>();
</script>
