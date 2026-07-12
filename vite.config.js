import { defineConfig } from 'vite';

export default defineConfig({
  // Electron 以 file:// 加载打包产物,必须用相对路径
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
