FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl python3 \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
RUN mkdir -p server/bin/ffmpeg server/tmp \
  && ln -sf /usr/local/bin/yt-dlp server/bin/yt-dlp \
  && ln -sf /usr/bin/ffmpeg server/bin/ffmpeg/ffmpeg \
  && ln -sf /usr/bin/ffprobe server/bin/ffmpeg/ffprobe

ENV NODE_ENV=production
ENV SLUGFETCH_HOST=0.0.0.0
ENV SLUGFETCH_PORT=8080

EXPOSE 8080
CMD ["node", "server/index.js"]
