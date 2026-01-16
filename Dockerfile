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
