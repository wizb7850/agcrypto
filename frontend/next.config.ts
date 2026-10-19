import type { NextConfig } from 'next';

// Le navigateur appelle /api/... sur le frontend, Next.js relaie vers le backend :
// une seule origine, donc pas de configuration CORS à gérer.
const backend = process.env.BACKEND_URL ?? 'http://localhost:3000';

const config: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${backend}/:path*` }];
  },
};

export default config;
