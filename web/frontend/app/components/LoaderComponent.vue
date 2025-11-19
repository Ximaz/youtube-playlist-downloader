<template>
  <div
    class="inline-block animate-spin rounded-full border-4 border-solid border-gray-300 border-t-transparent"
    :class="sizeClass"
    role="status"
  />
</template>

<script setup lang="ts">
const props = defineProps<{
  size?: "sm" | "md" | "lg";
}>();

const sizeClass = computed(() => {
  switch (props.size) {
    case "sm":
      return "h-4 w-4";
    case "lg":
      return "h-12 w-12";
    default:
      return "h-8 w-8";
  }
});
</script>
