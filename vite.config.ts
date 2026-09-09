import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    // Vite 8（rolldown）默认 oxc 压缩；esbuild 已非依赖，勿再指定 "esbuild"
  },
});
