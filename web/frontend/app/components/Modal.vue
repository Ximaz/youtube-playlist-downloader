<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <dialog v-if="props.open" class="modal">
    <div class="modal-box">
      <h3 class="text-lg font-bold">{{ props.title }}</h3>
      <p class="py-4">{{ props.description }}</p>
      <div class="modal-action">
        <form method="dialog">
          <button class="btn" @click="emitter('close')">Ok</button>
        </form>
      </div>
      <form method="dialog" class="modal-backdrop" @click="emitter('close')">
        <button>close</button>
      </form>
    </div>
  </dialog>
</template>

<script setup lang="ts">
const props = defineProps<{
  title: string;
  description: string;
  open: boolean;
}>();

const emitter = defineEmits<{ close: [] }>();
</script>
