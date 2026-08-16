import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    // Each spec gets a fresh module graph so global Counter registrations etc. don't leak.
    isolate: true,
    reporters: ['default'],
  },
});
