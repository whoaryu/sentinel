import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            // Gracefully handle backend offline without spamming console
            if ((err as any)?.code === 'ECONNREFUSED') {
              if (res && !res.headersSent && typeof (res as any).writeHead === 'function') {
                (res as any).writeHead(502, { 'Content-Type': 'application/json' });
                (res as any).end(JSON.stringify({ error: 'Backend daemon offline', code: 'ECONNREFUSED' }));
              }
            }
          });
        },
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
