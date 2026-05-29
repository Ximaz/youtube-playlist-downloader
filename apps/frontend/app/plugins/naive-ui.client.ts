import naive from 'naive-ui';

/** Register Naive UI globally on the Vue app instance.
 *
 *  `.client.ts` suffix scopes this plugin to client-side execution only — even
 *  though `nuxt.config.ts` sets `ssr: false`, the marker makes the intent
 *  obvious and avoids any future SSR-related setup work. The default theme is
 *  light; theme tokens live in `~/lib/theme.ts` and are applied via
 *  `<n-config-provider>` in `app.vue` (we deliberately keep the providers in
 *  the component tree so `useMessage`/`useLoadingBar` resolve them by injection). */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(naive);
});
