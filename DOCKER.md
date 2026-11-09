# ย้าย SignVoice ไปรันบนเครื่องอื่นด้วย Docker

Docker ทำให้เครื่องปลายทางใช้ **Node 26, Python 3.12, onnxruntime 1.31.1, PyTorch 2.14.1** เวอร์ชันเดียวกับเครื่องที่พัฒนา และใช้ **ข้อมูลชุดเดียวกัน** ทั้งบัญชีผู้ใช้ คำศัพท์ ท่าที่สอน และโมเดลที่เทรนแล้ว

```
เครื่องเรา                                   เครื่องเพื่อน (host)
───────────                                  ─────────────────────
git push  ─────────── โค้ด ─────────────▶   git clone
node scripts/export-data.mjs
 └─ signvoice-data.zip ─── ข้อมูล ──────▶   แตกไฟล์เป็น ./data
.env (API key) ─────── ส่งแยกแบบส่วนตัว ─▶   ./.env
                                             docker compose up -d --build
```

| container | มีอะไร |
|---|---|
| `app` | เว็บ (Node) + บริการแปลท่า (Python) ข้อมูลอยู่ที่ `./data` |
| `ollama` | LLM สำหรับเรียงประโยค |
| `ollama-pull` | ดาวน์โหลด `qwen3:4b-instruct` ครั้งแรกครั้งเดียว แล้วจบ |

---

## ฝั่งเรา: เตรียมข้อมูล

1. ส่งออกข้อมูล:
   ```powershell
   cd <โฟลเดอร์ SignVoice>
   node scripts/export-data.mjs
   powershell Compress-Archive -Path data-export\* -DestinationPath signvoice-data.zip
   ```
   ได้ไฟล์ `signvoice-data.zip` ราว 200 MB ข้างในมี:
   - `signvoice.db`: บัญชี (รหัสผ่านเข้ารหัสแล้ว) คำศัพท์ ท่าที่สอน ท่ารออนุมัติ ประวัติการแปล
   - `models/tsl51/`: โมเดลแปลท่า + โมเดลที่เทรนกับท่าของเรา + ข้อมูลทบทวนสำหรับเทรนต่อ
   - `tts_cache/`: เสียงที่เคยพูดแล้ว (ประหยัดเครดิต ElevenLabs)
2. ส่ง `signvoice-data.zip` ให้เพื่อนผ่าน Google Drive หรือ USB **อย่าใส่ใน git** (`.gitignore` กันไว้แล้ว)
3. ส่งไฟล์ `.env` ให้เพื่อนแยกต่างหาก ทางแชตส่วนตัว เพราะมี ElevenLabs API key

> ข้อมูลในเครื่องเราไม่ถูกลบหรือย้าย สคริปต์แค่ก๊อปออกมา

---

## ฝั่งเพื่อน (เครื่อง host)

### ติดตั้งครั้งแรก
1. ติดตั้ง **Docker Desktop** และ **Git**
   - ถ้ามีการ์ดจอ NVIDIA ให้อัปเดตไดรเวอร์ด้วย Docker Desktop บน Windows ใช้ GPU ได้เลย
2. ดึงโค้ด:
   ```powershell
   git clone https://github.com/Patcharanat23/SignVoice.git
   cd SignVoice
   ```
3. แตก `signvoice-data.zip` ให้กลายเป็นโฟลเดอร์ `data`:
   ```
   SignVoice\data\signvoice.db
   SignVoice\data\models\tsl51\...
   ```
4. วางไฟล์ `.env` ที่ได้รับไว้ใน `SignVoice\`
5. สร้างและเปิดระบบ:
   ```powershell
   # มีการ์ดจอ NVIDIA (LLM เร็วกว่ามาก)
   docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
   # ไม่มีการ์ดจอ NVIDIA
   docker compose up -d --build
   ```
   - ครั้งแรกใช้เวลา 10–20 นาที เพราะต้องดาวน์โหลด PyTorch, MediaPipe และ Qwen3 (~2.5 GB)
6. เปิด **http://localhost:5173** แล้วล็อกอินด้วยบัญชีเดิมได้เลย บัญชีและรหัสผ่านย้ายมาพร้อม `signvoice.db`

### คำสั่งที่ใช้บ่อย
| ต้องการ | คำสั่ง |
|---|---|
| ดูสถานะ | `docker compose ps` |
| ดู log | `docker compose logs -f app` |
| ปิด | `docker compose down` (ข้อมูลใน `./data` ไม่หาย) |
| อัปเดตโค้ด | `git pull` แล้ว `docker compose up -d --build` |
| สำรองข้อมูล | ก๊อปโฟลเดอร์ `data` เก็บไว้ (ตอนปิดระบบ) |

### ให้คนอื่นเข้าใช้ผ่านอินเทอร์เน็ต
เบราว์เซอร์อนุญาตให้ใช้กล้องเฉพาะ `localhost` หรือ **HTTPS** ถ้าจะให้คนอื่นเข้าใช้ ต้องมี HTTPS วิธีที่ง่ายและฟรีคือ **Cloudflare Tunnel** บนเครื่อง host:

```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:5173
```
จะได้ลิงก์ `https://xxxx.trycloudflare.com` ส่งให้คนอื่นใช้ได้เลย ระบบจะ:
- เปิด Secure cookie และ HSTS เองเมื่อเข้าผ่าน HTTPS
- ใช้ IP จริงของผู้ใช้ในการกันเดารหัส (`SIGNVOICE_TRUST_PROXY=1` ใน `docker-compose.yml`)
- เปิดพอร์ต 5173 ให้เฉพาะเครื่อง host (`127.0.0.1`) คนในวง LAN จึงปลอม header ไม่ได้

ลิงก์ `trycloudflare` เปลี่ยนทุกครั้งที่รันใหม่ ถ้าต้องการลิงก์ถาวร ให้สร้าง named tunnel ในบัญชี Cloudflare

---

## สิ่งที่ต่างจากการรันบน Windows ตรง ๆ

| เรื่อง | ใน Docker |
|---|---|
| แปลท่า, ล็อกอิน, ฐานข้อมูล, แอดมิน | เหมือนเดิมทุกอย่าง |
| ตัวจับมือ (MediaPipe) | รันในเบราว์เซอร์ของผู้ใช้ ใช้การ์ดจอเครื่องผู้ใช้ ไม่ใช่ของ host |
| LLM (Qwen3) | ใช้ GPU ของ host ถ้าเปิด `docker-compose.gpu.yml` |
| ปุ่ม "เทรนโมเดล" | ใช้ PyTorch แบบ CPU ช้ากว่าบน RTX (ราว 3–10 นาทีแทน ~1 นาที) |
| เสียงสำรองในเครื่อง (ThonburianTTS) | ปิดไว้เป็นค่าเริ่มต้น เพื่อให้ image เล็ก ถ้าจะเปิด: `docker compose build --build-arg LOCAL_TTS=1` |
| เสียงภาษาอังกฤษของ Windows | ไม่มีใน Linux (ใช้ ElevenLabs แทน) |

---

## ย้ายข้อมูลกลับ หรือย้ายต่อไปเครื่องอื่น
ข้อมูลทั้งหมดอยู่ในโฟลเดอร์ `data` ของ host
- **ย้ายไปเครื่องอื่น:** ปิดระบบ (`docker compose down`) แล้วก๊อป `data` ไปวางในโปรเจกต์ของเครื่องใหม่
- **ย้ายกลับมาใช้แบบไม่มี Docker บนเครื่องเรา:** ก๊อปไฟล์ใน `data` ไปทับ `C:\Users\<ชื่อ>\.signvoice\` (ควรสำรองของเดิมก่อน)
