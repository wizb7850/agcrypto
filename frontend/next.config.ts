import type { NextConfig } from 'next';

// Le navigateur appelle /api/... sur le frontend, Next.js relaie vers le backend :
// une seule origine, donc pas de configuration CORS à gérer.
// 127.0.0.1 plutôt que localhost : sur certains systèmes, localhost est résolu en IPv6 (::1)
// alors que le backend écoute en IPv4.
const backend = process.env.BACKEND_URL ?? 'http://127.0.0.1:3000';

const config: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${backend}/:path*` }];
  },
};

export default config;
