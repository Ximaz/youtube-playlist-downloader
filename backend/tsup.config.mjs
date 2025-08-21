import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/**/*.ts"],
  outDir: "dist",
  splitting: false,
  sourcemap: false,
  clean: true,
  dts: false,
  format: ["esm"],
  target: "esnext",
  minify: true,
  bundle: false,
  treeshake: true,
  onSuccess: "tsc-alias -p tsconfig.json",
});
