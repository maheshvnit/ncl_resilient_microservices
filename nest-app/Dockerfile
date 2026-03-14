### Build stage
FROM node:20-alpine AS builder
WORKDIR /usr/src/app
COPY package.json package-lock.json* ./
RUN npm install --silent
COPY . .
RUN npm run build

### Run stage
FROM node:20-alpine AS runner
WORKDIR /usr/src/app
ENV NODE_ENV=production
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/templates ./templates
COPY package.json ./
EXPOSE 3001
CMD ["node", "dist/main.js"]
