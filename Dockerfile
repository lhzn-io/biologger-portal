# Stage 1: Build the React application
FROM node:20-alpine AS build
WORKDIR /app

# Copy package configurations
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --legacy-peer-deps

# Copy source assets
COPY . .

# Compile TypeScript and bundle the application
RUN npm run build

# Stage 2: Serve the compiled client assets via Nginx
FROM nginx:alpine

# Copy bundled production assets from compile stage
COPY --from=build /app/dist /usr/share/nginx/html

# Expose HTTP port
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
