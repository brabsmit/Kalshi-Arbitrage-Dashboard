# Use Node.js 20 Alpine for smaller image size
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY kalshi-dashboard/package*.json ./kalshi-dashboard/

# Install dependencies
WORKDIR /app/kalshi-dashboard
RUN npm install

# Copy application code
COPY kalshi-dashboard ./

# Accept build arguments for environment variables
ARG VITE_APP_PASSWORD
ARG VITE_ODDS_API_KEY

# Set as environment variables for build
ENV VITE_APP_PASSWORD=$VITE_APP_PASSWORD
ENV VITE_ODDS_API_KEY=$VITE_ODDS_API_KEY

# Build the application
RUN npm run build

# Expose port (Railway will set this via $PORT)
EXPOSE 3000

# Create startup script
RUN echo '#!/bin/sh' > /start.sh && \
    echo 'npx vite preview --host 0.0.0.0 --port ${PORT:-3000}' >> /start.sh && \
    chmod +x /start.sh

# Start the preview server with proxies
CMD ["/start.sh"]
