# ---------- Builder stage ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Install deps based on lockfile
COPY package*.json ./
RUN npm ci -f

# Copy the app source
COPY . .

# Build Next.js app
RUN npm run build

# ---------- Runtime stage ----------
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Only copy package files needed at runtime
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev -f

# Copy built app and public assets from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public


# Next.js listens on 3000 by default
EXPOSE 3000

# Start Next.js in production mode
CMD ["npm", "run", "start"]