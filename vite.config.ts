import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(() => {
  return {
    // En GitHub Pages la app vive en https://<usuario>.github.io/<repo>/ ; el workflow define BASE_PATH.
    base: process.env.BASE_PATH || '/',
    server: {
      port: 3000,
      host: '127.0.0.1',
    },
    plugins: [react(), tailwindcss()],
    worker: { format: 'es' as const },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
