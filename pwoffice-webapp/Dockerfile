FROM node:18-alpine

# Install SQLite compile dependencies (needed for node-sqlite3 on some Alpine builds)
RUN apk add --no-repeat python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
