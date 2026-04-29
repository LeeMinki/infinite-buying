FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
RUN mkdir -p /var/lib/study-note/backend

EXPOSE 3001

CMD ["sh", "-c", "npm run migrate && npm start"]
