import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    basicSsl()
  ],
  server: {
    // 1. HOST: true exposes the app to your local network (and internet via port forwarding)
    host: true, 
    // 2. PORT: Standardize the port (e.g., 3000) so your router settings are easier
    port: 3000,
    // 3. ALLOWED HOSTS: Whitelist your DDNS domain to prevent "Blocked Request" errors
    allowedHosts: [
      'bryan-desktop.ddns.net'
    ],
    // 4. SECURITY HEADERS: Protect against clickjacking and other attacks
    headers: {
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.the-odds-api.com; img-src 'self' data:; font-src 'self' data:; object-src 'none'; base-uri 'self';",
    },
    proxy: {
      '/api/kalshi': {
        target: process.env.KALSHI_API_URL ? `${process.env.KALSHI_API_URL}/trade-api/v2` : 'https://api.elections.kalshi.com/trade-api/v2',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kalshi/, ''),
        // Sentinel: Verify SSL for production. Only disable for localhost dev.
        secure: process.env.KALSHI_API_URL ? !process.env.KALSHI_API_URL.includes('localhost') : true,
        // CRITICAL FIX: Set Origin to the target domain to satisfy WAF/CORS checks
        configure: (proxy, _options) => {
          const target = process.env.KALSHI_API_URL || 'https://api.elections.kalshi.com';
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            proxyReq.setHeader('Origin', target);
          });
        },
      },
      '/kalshi-ws': {
        target: process.env.KALSHI_API_URL ? `${process.env.KALSHI_API_URL.replace('https', 'wss')}/trade-api/ws/v2` : 'wss://api.elections.kalshi.com/trade-api/ws/v2',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/kalshi-ws/, ''),
        // Sentinel: Verify SSL for production. Only disable for localhost dev.
        secure: process.env.KALSHI_API_URL ? !process.env.KALSHI_API_URL.includes('localhost') : true,
        configure: (proxy, _options) => {
          proxy.on('proxyReqWs', (proxyReq, req, socket, options, head) => {
            // FIX: Set Origin header for WS to satisfy WAF
            const origin = process.env.KALSHI_API_URL || 'https://api.elections.kalshi.com';
            proxyReq.setHeader('Origin', origin);

            const url = new URL(req.url, 'http://localhost');
            const key = url.searchParams.get('key');
            const sig = url.searchParams.get('sig');
            const ts = url.searchParams.get('ts');

            if (key && sig && ts) {
              proxyReq.setHeader('KALSHI-ACCESS-KEY', key);
              proxyReq.setHeader('KALSHI-ACCESS-SIGNATURE', sig);
              proxyReq.setHeader('KALSHI-ACCESS-TIMESTAMP', ts);
            }
          });
        },
      }
    },
  },
})