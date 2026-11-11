import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// Отдельная конфигурация статической SPA-сборки для GitHub Pages.
// Не трогает основной vinext/Worker-пайплайн (vite.config.ts, npm run build).
export default defineConfig({
 root:'static',
 base:'./',
 publicDir:'../public',
 plugins:[react()],
 build:{
  outDir:'../dist-static',
  emptyOutDir:true,
 },
});
