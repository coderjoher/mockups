/** @type {import('next').NextConfig} */
const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:4000';
export default {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
};
