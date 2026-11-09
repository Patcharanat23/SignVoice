# Running with Docker

Docker gives another machine the same runtime (Node 26, Python 3.12, onnxruntime 1.31.1, PyTorch 2.14.1) and, if you copy it, the same data: accounts, vocabulary, recorded signs and trained models.

| Container | Contents |
|---|---|
| `app` | Web server (Node) and ML service (Python). Data in `./data`. |
| `ollama` | LLM for sentence ordering |
| `ollama-pull` | Downloads `qwen3:4b-instruct` once, then exits |

## 1. Export data (source machine)

```powershell
node scripts/export-data.mjs
powershell Compress-Archive -Path data-export\* -DestinationPath signvoice-data.zip
```

The zip (about 200 MB) contains `signvoice.db` (accounts with hashed passwords, vocabulary, samples, history), `models/tsl51/` and `tts_cache/`. Share it privately (Drive, USB). Never commit it; `.gitignore` already excludes it. Send the `.env` file separately because it holds the ElevenLabs key. The export only copies; nothing on the source machine changes.

## 2. Set up the host

1. Install Docker Desktop and Git. With an NVIDIA GPU, update the driver.
2. Get the code:
   ```powershell
   git clone https://github.com/Patcharanat23/SignVoice.git
   cd SignVoice
   ```
3. Unzip the data so you have `data\signvoice.db` and `data\models\tsl51\...`.
4. Put `.env` in the project folder.
5. Build and start:
   ```powershell
   # NVIDIA GPU
   docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
   # CPU only
   docker compose up -d --build
   ```
   The first build takes 10 to 20 minutes (PyTorch, MediaPipe and Qwen3, about 2.5 GB).
6. Open http://localhost:5173 and sign in with an existing account.

## Everyday commands

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| Logs | `docker compose logs -f app` |
| Stop (data is kept) | `docker compose down` |
| Update | `git pull`, then `docker compose up -d --build` |
| Back up | Copy the `data` folder while stopped |

## Sharing over the internet

Browsers allow the camera only on `localhost` or HTTPS. Cloudflare Tunnel is the simplest free option:

```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:5173
```

Share the `https://….trycloudflare.com` link. The server switches to `Secure` cookies and HSTS, uses the client's real IP for rate limiting (`SIGNVOICE_TRUST_PROXY=1`), and port 5173 stays bound to `127.0.0.1`, so devices on the LAN cannot spoof tunnel headers. The link changes on every run; create a named tunnel for a permanent one.

## Differences from running on Windows directly

| | In Docker |
|---|---|
| Recognition, accounts, database, admin | Same |
| MediaPipe | Runs in each user's browser on their own GPU |
| Qwen3 | Uses the host GPU with `docker-compose.gpu.yml` |
| Training button | CPU PyTorch, about 3 to 10 minutes |
| ThonburianTTS fallback | Off by default to keep the image small. Enable with `docker compose build --build-arg LOCAL_TTS=1` |
| Windows English voice | Not available on Linux; ElevenLabs is used |

## Moving data back

All data is in `./data`. Stop the containers and copy the folder to another host, or copy its contents into `%USERPROFILE%\.signvoice\` to run without Docker (back up the old files first).
