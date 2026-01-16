# Kalshi Arbitrage Dashboard

Real-time sports arbitrage opportunity scanner for Kalshi prediction markets.

## Features

- Real-time arbitrage opportunity detection across multiple sportsbooks
- Live WebSocket feeds from Kalshi markets
- Automated bid placement and position management
- Portfolio tracking and P&L monitoring
- Password-protected access for security

## Quick Start

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/Kalshi-Arbitrage-Dashboard.git
cd Kalshi-Arbitrage-Dashboard
```

2. Set up environment variables:
```bash
cd kalshi-dashboard
cp .env.example .env
# Edit .env and add your API keys and password
```

3. Install dependencies and run:
```bash
npm install
npm run dev
```

4. Open https://localhost:3000

### Deploy to Vercel

See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete deployment instructions.

Quick steps:
1. Push to GitHub
2. Import project to Vercel
3. Add environment variables (`VITE_APP_PASSWORD`, `VITE_ODDS_API_KEY`)
4. Deploy

## Environment Variables

Required:
- `VITE_APP_PASSWORD` - Dashboard access password
- `VITE_ODDS_API_KEY` - The Odds API key

Optional:
- `KALSHI_API_URL` - Custom Kalshi API endpoint (defaults to production)

## Security

- Password authentication protects dashboard access
- API keys stored as environment variables
- Server-side proxy prevents credential exposure
- Session-based authentication (clears on browser close)

## Tech Stack

- React + Vite
- TailwindCSS
- Recharts for visualization
- WebSocket for real-time data
- Lucide React for icons

## Documentation

- [Deployment Guide](./DEPLOYMENT.md) - Complete deployment instructions
- [Strategy Documentation](./strategy.md) - Arbitrage strategy details
- Vercel

## License

Private - Proprietary Strategy
