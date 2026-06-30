# --- build stage: compile the Vite SPA -------------------------------------
FROM node:22 AS build

WORKDIR /app

# Install deps first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Build (runs `tsc --noEmit && vite build` -> dist/).
COPY . .
RUN npm run build

# --- runtime stage: serve static files + proxy /api ------------------------
FROM nginx:alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
