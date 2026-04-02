FROM node:22-slim

# SQLCipher-Abhängigkeiten
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    libsqlcipher-dev \
    gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Abhängigkeiten zuerst (Docker-Layer-Caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Anwendungscode
COPY . .

# Daten-Volume-Verzeichnis anlegen (Permissions werden zur Laufzeit gesetzt)
RUN mkdir -p /data

# Entrypoint: korrigiert /data-Permissions und startet als node-User
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server/index.js"]
