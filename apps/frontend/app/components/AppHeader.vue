<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import { computed } from 'vue';

import GoogleConnectButton from './GoogleConnectButton.vue';

const props = defineProps<{
  /** null = /auth/me in flight, false = signed out, true = signed in. */
  signedIn: boolean | null;
  /** OpenID profile from /auth/me (the `profile` scope). Null when unknown. */
  name: string | null;
  picture: string | null;
}>();

const emit = defineEmits<{ (e: 'sign-out'): void }>();

const displayName = computed(() => props.name ?? 'Signed in');
// First-letter initial as the avatar fallback when Google returns no picture.
const initial = computed(() => (props.name?.trim()?.[0] ?? '·').toUpperCase());

const menuItems = computed<DropdownMenuItem[]>(() => [
  { label: 'Disconnect', icon: 'i-lucide-log-out', onSelect: () => emit('sign-out') },
]);
</script>

<template>
  <header
    class="sticky top-0 z-50 border-b border-line bg-paper/80 backdrop-blur-[14px] backdrop-saturate-150"
  >
    <div class="mx-auto flex max-w-280 items-center justify-between px-7 py-4 max-[680px]:px-4">
      <!-- Brand lockup: 30px mark (verbatim §5) + two-line text block. -->
      <div class="flex items-center gap-3">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9.2" stroke="#bb5a3a" stroke-width="1.6" />
          <circle cx="12" cy="12" r="2.3" fill="#bb5a3a" />
          <circle cx="12" cy="5.4" r="1.15" fill="#968d80" />
          <circle cx="17.8" cy="14.5" r="1.15" fill="#968d80" />
          <circle cx="6.2" cy="14.5" r="1.15" fill="#968d80" />
        </svg>
        <div class="leading-none">
          <div class="font-display text-[20px] font-extrabold tracking-[0.14em] text-ink">YPD</div>
          <div
            class="mt-1 font-mono text-[10.5px] tracking-[0.01em] text-ink-faint max-[560px]:hidden"
          >
            Download any YouTube playlist
          </div>
        </div>
      </div>

      <!-- #authSlot -->
      <div>
        <div
          v-if="signedIn === null"
          class="flex items-center gap-2 font-mono text-[11px] text-ink-faint"
        >
          <svg
            class="size-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-6.22-8.56" stroke-linecap="round" />
          </svg>
          Checking…
        </div>

        <GoogleConnectButton v-else-if="signedIn === false" />

        <UDropdownMenu v-else :items="menuItems" :content="{ align: 'end' }">
          <button
            type="button"
            class="flex items-center gap-2.5 rounded-[13px] border border-line bg-paper-2 py-1.5 pr-2.5 pl-1.5 shadow-paper-sm transition hover:-translate-y-px hover:shadow-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <img
              v-if="picture"
              :src="picture"
              :alt="displayName"
              referrerpolicy="no-referrer"
              class="size-7.5 rounded-[9px] object-cover"
            />
            <span
              v-else
              class="grid size-7.5 place-items-center rounded-[9px] bg-accent-tint font-display text-[13px] font-bold text-accent-ink"
            >
              {{ initial }}
            </span>
            <span class="text-left leading-tight max-[560px]:hidden">
              <span class="block max-w-40 truncate text-[14px] font-semibold text-ink">{{
                displayName
              }}</span>
              <span class="block font-mono text-[11px] text-ink-faint">Google account</span>
            </span>
            <svg
              class="size-4 text-ink-faint"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </UDropdownMenu>
      </div>
    </div>
  </header>
</template>
