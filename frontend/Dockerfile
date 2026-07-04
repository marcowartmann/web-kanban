# --- build stage: compile the Vite SPA -------------------------------------
FROM node:22 AS build

WORKDIR /app

# Install deps first for better layer caching. .npmrc points the @fortawesome
# scope at the Pro registry and reads the token from FONTAWESOME_PACKAGE_TOKEN,
# supplied as a BuildKit secret (never baked into a layer or the image).
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=secret,id=fa_token \
    FONTAWESOME_PACKAGE_TOKEN="$(cat /run/secrets/fa_token)" npm ci

# Build (runs `tsc --noEmit && vite build` -> dist/).
COPY . .
RUN npm run build

# --- runtime stage: serve static files + proxy /api ------------------------
FROM nginx:alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
