// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  devServer: {
    port: 4000,
  },
  compatibilityDate: "2025-07-15",
  devtools: { enabled: false },
  modules: ["@nuxt/eslint", "@pinia/nuxt", "pinia-plugin-persistedstate/nuxt"],
  router: {
    options: {
      scrollBehaviorType: "smooth",
    },
  },
  css: ["~/assets/css/main.css"],
  app: { head: { title: "Youtube Playlist Downloader" } },
  ssr: false,
  nitro: {
    experimental: {
      websocket: true,
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
