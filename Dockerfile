FROM node:20-alpine

# Set working directory inside the container
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the app source
COPY . .

# Build the Next.js app
RUN npm run build

# Next.js listens on port 3000 by default
EXPOSE 3000

# Start the app in production mode
CMD ["npm", "run", "start"]