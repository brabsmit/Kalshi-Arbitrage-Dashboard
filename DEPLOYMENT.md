# Deployment Guide - Kalshi Arbitrage Dashboard

This guide covers deploying the Kalshi Arbitrage Dashboard to **Railway** with password authentication.

**Why Railway?** Railway supports WebSockets and server-side proxies, which are essential for the auto-bidding and real-time features of this dashboard. Vercel has limitations with these features.

## Prerequisites

- GitHub account
- Railway account (sign up at https://railway.app - free $5/month credit)
- Your API keys ready

## Environment Variables

You'll need to set these environment variables in Railway:

### Required Variables

1. **`VITE_APP_PASSWORD`** - The password to access your dashboard
   - Example: `my-secure-password-2024`
   - This can be any string you want
   - Users will need this password to access the dashboard

2. **`VITE_ODDS_API_KEY`** - Your Odds API key from The Odds API
   - Get it from: https://the-odds-api.com/
   - Example: `1234567890abcdef1234567890abcdef`

3. **`PORT`** - The port Railway will use (Railway sets this automatically)
   - You don't need to set this - Railway handles it

### Optional Variables (for custom Kalshi endpoints)

4. **`KALSHI_API_URL`** (optional)
   - Only needed if using a custom Kalshi API endpoint
   - Default: `https://api.elections.kalshi.com`
   - Example: `https://demo-api.elections.kalshi.com`

## Deployment Steps

### Step 1: Push Code to GitHub

```bash
git add .
git commit -m "Add Railway deployment configuration"
git push origin main
```

### Step 2: Create Railway Project

1. Go to https://railway.app/new
2. Click **"Deploy from GitHub repo"**
3. Select your repository: `Kalshi-Arbitrage-Dashboard`
4. Railway will automatically detect the `nixpacks.toml` configuration

### Step 3: Configure Environment Variables

In the Railway project dashboard:

1. Click on your deployment
2. Go to the **Variables** tab
3. Add the following variables:

| Variable Name | Value |
|--------------|-------|
| `VITE_APP_PASSWORD` | Your chosen password |
| `VITE_ODDS_API_KEY` | Your Odds API key |

**Note**: Railway automatically sets `PORT`, so you don't need to add it.

### Step 4: Deploy

1. Railway will automatically start building and deploying
2. Wait for the build to complete (usually 2-3 minutes)
3. Click **"Generate Domain"** to get a public URL
4. Your app will be live at `https://your-project.up.railway.app`

### Step 5: Test Your Deployment

1. Visit your Railway URL
2. You should see a password login screen
3. Enter your password (the value you set for `VITE_APP_PASSWORD`)
4. You should be able to access the dashboard with full functionality:
   - ✅ Real-time WebSocket connections
   - ✅ Auto-bidding
   - ✅ Live market updates
   - ✅ Portfolio tracking

## Custom Domain (Optional)

To use a custom domain like `arbitrage.yourdomain.com`:

1. In your Railway project, go to **Settings** → **Domains**
2. Click **"Add Custom Domain"**
3. Enter your domain name
4. Follow Railway's DNS configuration instructions

## Security Notes

### Password Authentication

- The password is checked client-side (simple protection)
- Authentication persists for the browser session only
- Closing the browser clears authentication
- For better security, consider upgrading to email whitelist authentication

### API Key Security

- Never commit `.env` files to GitHub
- All API keys should be stored as Railway environment variables
- The Vite proxy server protects your credentials from being exposed in the browser

### Monitoring Access

Railway provides deployment logs and metrics:
- Go to **Deployments** in your Railway dashboard
- View logs, metrics, and resource usage
- Monitor active connections and WebSocket status

## Updating Your Deployment

Railway automatically redeploys when you push to GitHub:

```bash
# Make changes to your code
git add .
git commit -m "Your update message"
git push origin main
```

Railway will automatically:
1. Build your updated code
2. Deploy with zero downtime
3. Roll back if the build fails

## Troubleshooting

### "Password is incorrect" even with correct password

1. Check that `VITE_APP_PASSWORD` is set correctly in Railway
2. Redeploy the project after adding/changing environment variables
3. Clear your browser cache and try again

### API requests failing

1. Check that `VITE_ODDS_API_KEY` is set correctly
2. Verify your Odds API key is valid at https://the-odds-api.com/
3. Check Railway deployment logs for detailed error messages

### Build failures

1. Check the build logs in Railway dashboard
2. Verify `package.json` dependencies are correct
3. Try running `npm run build` locally first
4. Make sure `nixpacks.toml` is in the root directory

### WebSocket connections not working

1. Check Railway deployment logs for WebSocket errors
2. Ensure the preview server is running (check logs for "preview server running")
3. Verify that the PORT environment variable is being used correctly

### Application not responding

1. Check Railway logs for crashes or errors
2. Verify the start command is correct in `nixpacks.toml`
3. Make sure the health check is passing
4. Railway free tier has resource limits - check your usage

## Local Development

To test locally with the same configuration:

1. Create `.env` file in `kalshi-dashboard/` directory:
```bash
VITE_APP_PASSWORD=your-password
VITE_ODDS_API_KEY=your-odds-api-key
```

2. Run the dev server:
```bash
cd kalshi-dashboard
npm install
npm run dev
```

3. Open https://localhost:3000

## Railway Free Tier Limits

The Railway free tier includes:
- $5 USD of usage per month
- 512 MB RAM
- 1 GB disk space
- Shared CPU

This should be sufficient for personal use. Monitor your usage in the Railway dashboard.

## Support

- Railway Documentation: https://docs.railway.app
- Railway Discord: https://discord.gg/railway

## Changing Your Password

To change the dashboard password:

1. Go to Railway → Your Project → **Variables**
2. Find `VITE_APP_PASSWORD`
3. Click **Edit** and enter your new password
4. Railway will automatically redeploy

All existing sessions will be invalidated, and users will need to log in again with the new password.

---

## Alternative: Vercel Deployment (Limited Functionality)

If you prefer Vercel despite the limitations:
- See [DEPLOYMENT_VERCEL.md](./DEPLOYMENT_VERCEL.md) for instructions
- Note: WebSockets will have timeouts, auto-bidding may not work properly
