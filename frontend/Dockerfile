FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .

# Build the production bundle so the image can serve it directly; the
# dev compose stack overrides the command (and mounts the source tree)
# so local development still uses `npm run dev`.
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
