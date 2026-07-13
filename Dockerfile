FROM node:20-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm install

COPY server/ ./server/

RUN cd server && npx prisma generate

WORKDIR /app/server

EXPOSE 3001

# JSON form + exec: node diventa PID 1 e riceve correttamente SIGTERM da Railway.
# --accept-data-loss: db push non è interattivo in container; senza flag un warning
# (anche innocuo, es. unique su colonna nuova) manda il deploy in crash-loop.
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node prisma/seed.js && exec node src/index.js"]
