FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# uploads/ and data/ are created at startup, so they must be writable by the app user.
RUN mkdir -p uploads data && chown -R node:node /app
USER node

EXPOSE 3000

ENV NODE_ENV=production

CMD ["npm", "start"]