// Nuxt 4 config — SPA mode (ssr: false). The browser is served a static client AND
// Nitro acts as a Backend-for-Frontend: the browser only ever talks to this origin,
// and Nitro's server routes (server/) proxy REST + WebSocket to the backend over the
// internal Docker network, injecting the session token. `backendUrl` is therefore
// SERVER-ONLY runtime config — it is never shipped to the browser.
//
// Env var contract (translated by the Docker ENTRYPOINT before `node` starts):
//   BACKEND_URL   → NUXT_BACKEND_URL    (internal backend base, e.g. http://backend:3000)
//   COOKIE_SECURE → NUXT_COOKIE_SECURE  ('false' only for plain-http dev)
export default defineNuxtConfig({
  compatibilityDate: '2026-05-31',
  ssr: false,
  devtools: { enabled: false },
  modules: ['@nuxt/ui'],
  typescript: {
    strict: true,
    typeCheck: true,
  },
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      title: 'YPD — Download any YouTube playlist',
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap',
        },
      ],
    },
  },
  runtimeConfig: {
    // Server-only: the internal backend base URL the BFF proxy forwards to, and whether
    // to mark the session cookie `Secure` (true in prod behind HTTPS; 'false' for http dev).
    backendUrl: process.env.BACKEND_URL ?? 'http://backend:3000',
    cookieSecure: (process.env.COOKIE_SECURE ?? 'true') !== 'false',
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
