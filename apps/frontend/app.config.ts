// Nuxt UI design-system aliases. `primary` → the terracotta scale defined in
// app/assets/css/main.css; `neutral` → stone (the warmest built-in gray) so kit
// surfaces sit calmly on the paper background. Radius matches the spec's soft fields.
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'terracotta',
      neutral: 'stone',
    },
  },
});
