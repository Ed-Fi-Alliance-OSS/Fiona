# SPDX-License-Identifier: Apache-2.0
# Licensed to the Ed-Fi Alliance under one or more agreements.
# The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
# See the LICENSE and NOTICES files in the project root for more information.

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
