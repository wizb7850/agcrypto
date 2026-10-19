import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En développement, le navigateur appelle /api/... sur le frontend et Vite relaie vers le backend :
// une seule origine (cookies de session et pas de CORS à gérer). En production, le reverse proxy
// (Nginx, Caddy…) fait la même chose. 127.0.0.1 plutôt que localhost : évite la résolution IPv6.
const backend = process.env.BACKEND_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    strictPort: true,
    proxy: {
      '/api': { target: backend, changeOrigin: false, xfwd: true, rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
  preview: { port: 3001 },
});
