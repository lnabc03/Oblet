import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // tauri android dev 会注入 TAURI_DEV_HOST（局域网 IP），
    // 设备/模拟器经它访问 dev server；桌面开发时未设置则保持 localhost
    host: process.env.TAURI_DEV_HOST || false,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    // Vite 8（rolldown）默认 oxc 压缩；esbuild 已非依赖，勿再指定 "esbuild"
  },
});
