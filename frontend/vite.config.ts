import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(import.meta.dirname, '../backend'), '');
  return { plugins: [react(), tailwindcss()], envDir: '../backend', server: { fs: { allow: [path.resolve(import.meta.dirname), path.resolve(import.meta.dirname, '../backend')] }, host: 'localhost', port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:' + (env.PORT || '4000') } } };
});
