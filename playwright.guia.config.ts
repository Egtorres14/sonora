import { defineConfig } from '@playwright/test';

/**
 * Generador de capturas para las guías (`npm run guia:capturas`). Va aparte de la batería de CI:
 * no comprueba nada, produce las imágenes de public/guia a partir de la app real.
 */
export default defineConfig({
  testDir: './tests/guia', timeout: 180000, expect: { timeout: 20000 }, workers: 1,
  reporter: 'list', outputDir: 'output/playwright/guia',
  use: { baseURL: 'http://127.0.0.1:3018', viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, locale: 'es-ES', trace: 'off', screenshot: 'off' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 3018 --strictPort', url: 'http://127.0.0.1:3018', reuseExistingServer: false, timeout: 30000 },
});
