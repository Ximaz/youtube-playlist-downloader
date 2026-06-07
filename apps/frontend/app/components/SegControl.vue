<script setup lang="ts" generic="T extends string">
// Reusable segmented control (§6.4). Track = bg-track; active child = paper-2 + shadow +
// accent icon. Two render shapes: icon + word (Format), or stacked label + mono container
// name (Output, where the active `em` turns accent).
interface SegOption<V extends string> {
  value: V;
  label: string;
  icon?: 'audio' | 'video' | 'both';
  em?: string;
}

const props = defineProps<{
  modelValue: T;
  options: SegOption<T>[];
  label: string;
  /** Accessible name for the button group (rendered as aria-label). */
  groupName: string;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: T): void }>();

function isActive(value: T): boolean {
  return props.modelValue === value;
}
</script>

<template>
  <div>
    <span class="mb-2 block font-mono text-[10px] tracking-[0.16em] text-ink-faint uppercase">
      {{ label }}
    </span>
    <div role="group" :aria-label="groupName" class="inline-flex gap-1 rounded-[12px] bg-track p-1">
      <button
        v-for="opt in options"
        :key="opt.value"
        type="button"
        :aria-pressed="isActive(opt.value)"
        class="rounded-[9px] px-3.5 py-2 text-[13px] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        :class="
          isActive(opt.value)
            ? 'bg-paper-2 font-semibold text-ink shadow-paper-sm'
            : 'font-medium text-ink-soft hover:text-ink'
        "
        @click="emit('update:modelValue', opt.value)"
      >
        <!-- Output shape: word + mono container name, side by side -->
        <span v-if="opt.em" class="flex items-center gap-1.5">
          <span>{{ opt.label }}</span>
          <span
            class="font-mono text-[11px]"
            :class="isActive(opt.value) ? 'text-accent' : 'text-ink-faint'"
            >{{ opt.em }}</span
          >
        </span>

        <!-- Format shape: line icon + word (icon-less options render the word alone) -->
        <span v-else class="flex items-center gap-2">
          <svg
            v-if="opt.icon"
            class="size-4.25"
            :class="isActive(opt.value) ? 'text-accent' : 'text-ink-soft'"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <template v-if="opt.icon === 'audio'">
              <path d="M9 17.5V5l10-2.2v11" />
              <circle cx="6.5" cy="17.5" r="2.5" />
              <circle cx="16.5" cy="13.8" r="2.5" />
            </template>
            <template v-else-if="opt.icon === 'video'">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4" />
            </template>
            <template v-else>
              <path d="M12 3 3 8l9 5 9-5-9-5z" />
              <path d="m3 13 9 5 9-5" />
            </template>
          </svg>
          <span>{{ opt.label }}</span>
        </span>
      </button>
    </div>
  </div>
</template>
