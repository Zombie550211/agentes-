FROM node:18-slim

# Instalar FFmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar package.json primero para cache de dependencias
COPY package*.json ./
RUN npm install --production

# Copiar el resto del código
COPY . .

# Puerto
EXPOSE 3000

# Iniciar servidor
CMD ["node", "server.js"]
