import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    host: '0.0.0.0',
    // Dev only: the sandbox preview is served from a rotating *.e2b.app host.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        // Forward the public host so the Worker's same-origin (CSRF) check can
        // match the browser's Origin header exactly as it does behind Cloudflare.
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq, req) => {
            const host = req.headers.host;
            if (host) {
              const local = /^(localhost|127\.0\.0\.1)(:|\b)/.test(host);
              proxyReq.setHeader('x-forwarded-host', host);
              proxyReq.setHeader('x-forwarded-proto', local ? 'http' : 'https');
            }
          });
        },
      },
    },
  },
  preview: { port: 4173, host: '0.0.0.0', allowedHosts: true },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
});
