// Nuxt 4 config — SPA mode (ssr: false) so the app runs as a static client served
// by Nitro. Nitro is the runtime that reads `runtimeConfig.public.*` overrides at
// server start (the whole point of the migration: env vars must be runtime, not
// build-time).
//
// Env var contract: the project's user-facing env var is `BACKEND_URL` (no prefix).
//   - In dev (`nuxt dev`): read here at startup from `process.env.BACKEND_URL`.
//   - In the production container: the Docker ENTRYPOINT exports
//     `NUXT_PUBLIC_BACKEND_URL=$BACKEND_URL` BEFORE `node .output/server/index.mjs`
//     runs, so Nuxt's standard runtime-override path picks it up. (Nitro freezes
//     `runtimeConfig.public` after init, so a plugin can't mutate it — the env-var
//     shim has to happen pre-process.)
// In either case `NUXT_PUBLIC_BACKEND_URL` also works as a direct override.
export default defineNuxtConfig({
  compatibilityDate: '2026-05-31',
  ssr: false,
  devtools: { enabled: false },
  typescript: {
    strict: true,
    typeCheck: true,
  },
  css: ['~/assets/css/base.css'],
  app: {
    head: {
      title: 'YouTube Playlist Downloader',
    },
  },
  runtimeConfig: {
    public: {
      backendUrl: process.env.BACKEND_URL ?? 'http://localhost:3000',
    },
  },
  // Listen on 8080 inside the container to keep the existing port contract with
  // docker-compose + the user (nginx used to serve here too).
  devServer: {
    host: '127.0.0.1',
    port: 8080,
  },
  nitro: {
    preset: 'node-server',
  },
  vite: {
    server: {
      strictPort: true,
    },
  },
});
