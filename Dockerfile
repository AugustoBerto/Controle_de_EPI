FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY app.js server.js schema.sql ./
COPY public ./public
RUN mkdir /app/dados && chown node:node /app/dados
USER node
ENV HOST=0.0.0.0
EXPOSE 3000
CMD ["npm", "start"]
