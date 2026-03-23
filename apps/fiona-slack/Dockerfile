# Single-stage build for fiona-slack Socket Mode container
# No TypeScript build step needed -- plain JavaScript ESM

FROM node:22-alpine
WORKDIR /app

# Copy package manifests first for layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source
COPY src/ ./src/

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Socket Mode: no inbound port needed
# The app initiates an outbound WebSocket to Slack

CMD ["node", "src/app.js"]
