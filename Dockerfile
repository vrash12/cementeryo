# frontend/Dockerfile
# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci

# Vite env vars must exist at BUILD TIME
ARG VITE_API_BASE_URL
ARG VITE_API_BASE_URL_IMAGE
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_API_BASE_URL_IMAGE=$VITE_API_BASE_URL_IMAGE

COPY frontend ./frontend
RUN npm run build --workspace=frontend

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
