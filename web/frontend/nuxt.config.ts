// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devServer: {
    port: 4000,
  },
  compatibilityDate: "2025-07-15",
  devtools: { enabled: false },
  modules: ["@nuxt/eslint", "@nuxt/ui"],
  css: ["~/assets/css/main.css"],
  ui: {
    prefix: "U",
  },
  app: { head: { title: "Youtube Playlist Downloader" } },
  ssr: false,
  nitro: {
    experimental: {
      websocket: true,
    },
  },
});
