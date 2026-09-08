import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ command, mode }) => {
  // Llaves de API SOLO para `npm run dev`, leídas de .env.local (ignorado por git) con prefijo SONORA_DEV_KEY_.
  // No usan el prefijo VITE_ a propósito: Vite incrustaría esas variables en el bundle de producción.
  // Se inyectan en el index.html del servidor de desarrollo como window.__SONORA_DEV_KEYS__; en `vite build` no se tocan.
  const devEnv = loadEnv(mode, process.cwd(), 'SONORA_DEV_KEY_');
  const devKeys = Object.fromEntries(Object.entries(devEnv).map(([k, v]) => [k.replace('SONORA_DEV_KEY_', '').toLowerCase(), v]));
  const sonoraDevKeys = () => ({
    name: 'sonora-dev-keys',
    apply: 'serve' as const,
    transformIndexHtml: () => [{ tag: 'script', injectTo: 'head' as const, children: `window.__SONORA_DEV_KEYS__ = ${JSON.stringify(devKeys)};` }],
  });
  return {
    // En GitHub Pages la app vive en https://<usuario>.github.io/<repo>/ ; el workflow define BASE_PATH.
    base: process.env.BASE_PATH || '/',
    server: {
      port: 3000,
      host: '127.0.0.1',
    },
    plugins: [react(), tailwindcss(), sonoraDevKeys()],
    worker: { format: 'es' as const },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
