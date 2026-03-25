FROM node:20-slim

# SQLCipher-Abhängigkeiten
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    libsqlcipher-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Abhängigkeiten zuerst (Docker-Layer-Caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Anwendungscode
COPY . .

# Daten-Volume-Verzeichnis mit korrektem Besitzer (vor USER node!)
RUN mkdir -p /data && chown node:node /data

EXPOSE 3000

USER node

CMD ["node", "server/index.js"]
