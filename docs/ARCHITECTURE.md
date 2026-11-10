# Architecture

## Processes

| Process | Port | Code | Role |
|---|---|---|---|
| Web server (Node.js) | 5173 | `server.mjs`, `auth.mjs` | Serves the pages, REST API, sessions and permissions. Calls the other services. |
| ML service (Python) | 8766, localhost only | `ml/service.py` | Sign recognition (ONNX Runtime), fine-tuning, sample storage, local TTS. Started by the web server. |
| Ollama | 11434 | external | Runs Qwen3 4B for sentence ordering. |
| ElevenLabs | HTTPS | external | Speech synthesis when an API key is set. |

The browser never talks to the database or the ML service directly. Every request goes through the web server, which checks the session cookie and the user's role first.

```
browser ── JSON ──> server.mjs ── HTTP ──> ml/service.py ── sqlite3 ──> signvoice.db
                       ├── node:sqlite ──> signvoice.db   (users, sessions, auth log)
                       ├── HTTP ──> Ollama
                       └── HTTPS ──> ElevenLabs
```

## Recognition pipeline

1. **Landmarks (browser).** MediaPipe Hand Landmarker finds 21 points per hand; Pose Landmarker (lite) adds shoulders, elbows and wrists. Both run on the GPU with a CPU fallback. Only these points leave the page.
2. **Segmentation (browser, `src/signs.js`).** Recording starts when a hand appears and keeps the two frames before it. It ends when no hand is seen for 450 ms (1.2 s if the wrists are still raised, which bridges tracking drop-outs) or after 4.5 s. Clips with fewer than 6 hand frames are dropped.
3. **Features (`ml/features.py`, shared by training and inference).**
   - Centre on the mid-shoulder point and divide by shoulder width, so distance to the camera does not matter.
   - Hand shape relative to the wrist, scaled by wrist-to-middle-finger length.
   - Frame-to-frame velocity.
   - Resample the active span to 32 frames. Result: a 32 × 266 matrix per sign.
4. **Classifier (`ml/train_tsl.py`, `SignNet`).** Linear 266→192, three residual depthwise Conv1d blocks (kernel 5), a 2-layer Transformer encoder (4 heads), mean + max pooling, linear output. About 0.86 M parameters, exported to ONNX. A word is accepted only when softmax confidence is at least 0.35.
5. **Sentence ordering (`server.mjs`).** Thai Sign Language uses a different word order from spoken Thai (`ข้าว ฉัน กิน` → `ฉันกินข้าว`). Qwen3 4B reorders the words with temperature 0.1, then `repairThaiSentence()` in `src/language.js` cleans the result. The user can edit it before speaking.
6. **Speech.** ElevenLabs with the voice set in `ELEVENLABS_VOICE_ID` and fixed voice settings, so every sentence sounds the same; repeated sentences come from a cache. Without these settings or a network, ThonburianTTS runs on the local GPU.

## Data

One SQLite file, `~/.signvoice/signvoice.db`.

| Table | Written by | Contents |
|---|---|---|
| `users`, `sessions`, `auth_log` | `auth.mjs` | Accounts, hashed session tokens, login and admin events |
| `words` | `ml/db.py` | Vocabulary with Thai and English names |
| `samples` | `ml/db.py` | Recorded signs: label, frame count, keypoints (frames × 543 × 3, float16), status (approved or pending), proposer. No images or video. |
| `translations` | `ml/db.py` | Recognition history and user corrections |
| `training_runs` | `ml/db.py` | Fine-tuning results: words, samples, held-out accuracy before and after |

Models and caches live next to it under `~/.signvoice/models` and `~/.signvoice/tts_cache`.

## Training

**Base model** (`ml/train_combined.py`, once during development). TSL-51 and TSL-ONE, 236 classes. AdamW (lr 2e-3, weight decay 0.05) with OneCycle, 40 epochs, batch 256, label smoothing 0.1, class-balanced sampling, ±2-frame time shifts and small noise. Six signers are held out for evaluation; the deployed model is then retrained on everyone. About 15 minutes on an RTX 3060 Laptop GPU.

**Fine-tuning** (`ml/finetune_user.py`, the "train" button in the teach view). Starts from the base weights and uses the approved samples in the database. 20% of each word (when it has at least 4 samples) is held out to report before/after accuracy. Each sample gets up to 30 jittered copies plus mirrored copies, and 30 clips per base class are replayed so the model does not forget the original vocabulary. AdamW lr 3e-4, 12 epochs. About a minute on a GPU, 3 to 10 minutes on CPU.

## Pages

| Path | Who |
|---|---|
| `/login.html` | Everyone |
| `/?view=speak` | Signed-in users |
| `/` (teach) | Admins; other users are sent to the speak view |
| `/admin.html` | Admins: users, statistics, audit log, review queue |
