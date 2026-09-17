# Use Node 20 as required by your package.json engines field
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy dependency manifests first for better layer caching
COPY package*.json ./

# Install only production dependencies
# Using npm install instead of npm ci to resolve Linux-specific binaries
RUN npm install --omit=dev

# Copy the rest of your bot code
COPY . .

# Create directories for persistent data (session, state, vault)
RUN mkdir -p /app/session /app/state /app/vault

# Declare volumes so Kubeletto can mount persistent storage
VOLUME ["/app/session", "/app/state", "/app/vault"]

# Start the bot (your package.json main entry)
CMD ["node", "start.js"]
