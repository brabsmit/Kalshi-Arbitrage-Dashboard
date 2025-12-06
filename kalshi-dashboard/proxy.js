import { createProxyMiddleware } from 'http-proxy-middleware';

export default createProxyMiddleware({
  target: 'https://api.elections.kalshi.com', // Points to Production API
  changeOrigin: true,
  pathRewrite: {
    '^/api/kalshi': '/trade-api/v2', // Rewrites /api/kalshi/x -> /trade-api/v2/x
  },
  onProxyReq: (proxyReq, req, res) => {
    // CRITICAL: Strip the Origin header so Kalshi thinks this is a direct server call
    proxyReq.removeHeader('Origin');
    proxyReq.removeHeader('Referer');
  },
});