# SignVoice in one container: Node web server (+ built front end) and the Python sign-model service.
# Ollama runs as its own container (docker-compose.yml). All runtime data lives in the /data volume.
#
#   docker compose up -d --build
#
# Same versions as the development machine: Node 26, Python 3.12, onnxruntime 1.31.1, torch 2.14.1 (CPU).

FROM node:26-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/setup-assets.mjs scripts/setup-assets.mjs
# postinstall downloads the MediaPipe models and wasm into public/
RUN npm ci
COPY . .
RUN npm run build

FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 PYTHONUTF8=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 ca-certificates && rm -rf /var/lib/apt/lists/*
# Node runtime from the official image (same major version as development)
COPY --from=node:26-bookworm-slim /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY ml/requirements-docker.txt ml/requirements-docker.txt
# CPU build of PyTorch (used only for "เทรนโมเดล"); translation itself runs on onnxruntime
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.14.1 \
 && pip install -r ml/requirements-docker.txt
# Optional local Thai voice (ThonburianTTS, ~2 GB of extra packages): docker compose build --build-arg LOCAL_TTS=1
ARG LOCAL_TTS=0
RUN if [ "$LOCAL_TTS" = "1" ]; then pip install f5-tts==1.1.22; fi

COPY --from=web /app/node_modules ./node_modules
COPY --from=web /app/dist ./dist
COPY --from=web /app/public ./public
COPY . .

ENV NODE_ENV=production \
    PORT=5173 \
    SIGNVOICE_HOST=0.0.0.0 \
    SIGNVOICE_HOME=/data \
    SIGNVOICE_PYTHON=/usr/local/bin/python3 \
    OLLAMA_URL=http://ollama:11434
VOLUME /data
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:5173/login.html').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs", "--production"]
