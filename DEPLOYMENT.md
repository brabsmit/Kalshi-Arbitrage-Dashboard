# Deployment Guide - Kalshi Arbitrage Dashboard

This guide covers deploying the Kalshi Arbitrage Dashboard to Vercel with password authentication.

## Prerequisites

- GitHub account
- Vercel account (sign up at https://vercel.com)
- Your API keys ready

## Environment Variables

You'll need to set these environment variables in Vercel:

### Required Variables

1. **`VITE_APP_PASSWORD`** - The password to access your dashboard
   - Example: `my-secure-password-2024`
   - This can be any string you want
   - Users will need this password to access the dashboard

2. **`VITE_ODDS_API_KEY`** - Your Odds API key from The Odds API
   - Get it from: https://the-odds-api.com/
   - Example: `1234567890abcdef1234567890abcdef`

### Optional Variables (for custom Kalshi endpoints)

3. **`KALSHI_API_URL`** (optional)
   - Only needed if using a custom Kalshi API endpoint
   - Default: `https://api.elections.kalshi.com`
   - Example: `https://demo-api.elections.kalshi.com`

## Deployment Steps

### Step 1: Push Code to GitHub

```bash
git add .
git commit -m "Add Vercel deployment configuration and password authentication"
git push origin main
```

### Step 2: Connect to Vercel

1. Go to https://vercel.com/new
2. Click "Import Project"
3. Select your GitHub repository: `Kalshi-Arbitrage-Dashboard`
4. Vercel will auto-detect the configuration from `vercel.json`

### Step 3: Configure Environment Variables

In the Vercel project settings:

1. Go to **Settings** → **Environment Variables**
2. Add the following variables:

| Variable Name | Value | Environment |
|--------------|-------|-------------|
| `VITE_APP_PASSWORD` | Your chosen password | Production, Preview, Development |
| `VITE_ODDS_API_KEY` | Your Odds API key | Production, Preview, Development |

**IMPORTANT**: Make sure to select all three environments (Production, Preview, Development) for each variable.

### Step 4: Deploy

1. Click "Deploy"
2. Wait for the build to complete (usually 1-2 minutes)
3. Your app will be live at `https://your-project.vercel.app`

### Step 5: Test Your Deployment

1. Visit your Vercel URL
2. You should see a password login screen
3. Enter your password (the value you set for `VITE_APP_PASSWORD`)
4. You should be able to access the dashboard

## Custom Domain (Optional)

To use a custom domain like `arbitrage.yourdomain.com`:

1. Go to **Settings** → **Domains**
2. Add your custom domain
3. Follow Vercel's DNS configuration instructions

## Security Notes

### Password Authentication

- The password is checked client-side (simple protection)
- Authentication persists for the browser session only
- Closing the browser clears authentication
- For better security, consider upgrading to email whitelist authentication

### API Key Security

- Never commit `.env` files to GitHub
- All API keys should be stored as Vercel environment variables
- The Kalshi API proxy protects your credentials from being exposed in the browser

### Monitoring Access

Vercel provides analytics to see who's accessing your app:
- Go to **Analytics** in your Vercel dashboard
- View visitor data, page views, and performance metrics

## Updating Your Deployment

Vercel automatically redeploys when you push to GitHub:

```bash
# Make changes to your code
git add .
git commit -m "Your update message"
git push origin main
```

Vercel will automatically:
1. Build your updated code
2. Deploy to a preview URL
3. Promote to production if the build succeeds

## Troubleshooting

### "Password is incorrect" even with correct password

1. Check that `VITE_APP_PASSWORD` is set correctly in Vercel
2. Make sure the variable is set for "Production" environment
3. Redeploy the project after adding/changing environment variables

### API requests failing

1. Check that `VITE_ODDS_API_KEY` is set correctly
2. Verify your Odds API key is valid at https://the-odds-api.com/
3. Check Vercel function logs for detailed error messages

### Build failures

1. Check the build logs in Vercel dashboard
2. Verify `package.json` dependencies are correct
3. Try running `npm run build` locally first

### WebSocket connections not working

Vercel has limitations with WebSockets. If you experience issues:
- WebSocket connections may timeout after 5 minutes on free tier
- Consider upgrading to Vercel Pro for longer connection times
- Or use polling as a fallback for real-time updates

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

## Support

- Vercel Documentation: https://vercel.com/docs
- Vercel Support: https://vercel.com/support

## Changing Your Password

To change the dashboard password:

1. Go to Vercel → Your Project → **Settings** → **Environment Variables**
2. Find `VITE_APP_PASSWORD`
3. Click the three dots → **Edit**
4. Enter your new password
5. Redeploy the project (or push a new commit to trigger automatic deployment)

All existing sessions will be invalidated, and users will need to log in again with the new password.
