import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/kalshi': {
        target: 'https://api.elections.kalshi.com/trade-api/v2',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kalshi/, ''),
        secure: false,
        // CRITICAL FIX: Set Origin to the target domain to satisfy WAF/CORS checks
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            proxyReq.setHeader('Origin', 'https://api.elections.kalshi.com');
          });
        },
      },
      '/kalshi-ws': {
        target: 'wss://api.elections.kalshi.com/trade-api/v2/ws',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/kalshi-ws/, ''),
        secure: false,
      }
    },
  },
})