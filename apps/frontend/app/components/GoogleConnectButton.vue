<script setup lang="ts">
import { computed, ref } from 'vue';

import { signInUrl } from '../lib/api';

// Real OAuth: the anchor navigates to the backend's Google consent endpoint. We flip a
// local `loading` flag on click purely for feedback during the full-page redirect — there
// is no fake 950ms timer (§7 is simulated; this app uses the real flow).
const href = computed(() => signInUrl());
const loading = ref(false);

function onClick(): void {
  loading.value = true;
}
</script>

<template>
  <a
    :href="href"
    data-connect
    :aria-busy="loading"
    class="inline-flex items-center justify-center gap-2.5 rounded-[11px] border border-line bg-white px-4.5 py-2.75 text-[14px] font-semibold text-ink shadow-paper-sm transition hover:-translate-y-px hover:shadow-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    :class="{ 'pointer-events-none text-ink-faint': loading }"
    @click="onClick"
  >
    <template v-if="!loading">
      <svg viewBox="0 0 48 48" width="19" height="19" aria-hidden="true">
        <path
          fill="#EA4335"
          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        />
        <path
          fill="#4285F4"
          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        />
        <path
          fill="#FBBC05"
          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        />
      </svg>
      Connect with Google
    </template>
    <template v-else>
      <svg
        class="size-4.5 animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path d="M21 12a9 9 0 1 1-6.22-8.56" stroke-linecap="round" />
      </svg>
      Connecting…
    </template>
  </a>
</template>
