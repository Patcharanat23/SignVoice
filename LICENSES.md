# สิทธิ์การใช้งานของส่วนประกอบ (Third-party licences)

โปรเจกต์นี้ใช้เพื่อ **การศึกษาและนำเสนองานในรายวิชา ไม่ใช่เชิงพาณิชย์** หลายส่วนด้านล่างใช้สัญญาอนุญาต *Non-Commercial (NC)* จึงห้ามนำระบบหรือโมเดลที่ได้ไปขายหรือให้บริการเชิงพาณิชย์ หากจะนำไปใช้เชิงพาณิชย์ต้องขออนุญาตเจ้าของแต่ละรายการก่อน

ไฟล์โมเดลและชุดข้อมูลขนาดใหญ่ **ไม่ได้เก็บใน git** สคริปต์ `ml/download.py` และ `scripts/setup-assets.mjs` จะดาวน์โหลดจากแหล่งต้นทางมาไว้ที่ `%USERPROFILE%\.signvoice` และ `public/` ในเครื่อง รีโปนี้จึงไม่ได้แจกจ่ายไฟล์เหล่านั้นซ้ำ

| ส่วนประกอบ | ใช้ทำอะไร | เจ้าของ / แหล่ง | สัญญาอนุญาต | สิ่งที่ต้องทำตาม |
|---|---|---|---|---|
| MediaPipe Tasks Vision + โมเดล Holistic / Gesture / Face Landmarker | ตรวจจุดมือ ใบหน้า และลำตัวในเบราว์เซอร์ | Google ([mediapipe](https://github.com/google-ai-edge/mediapipe)) | Apache-2.0 | ระบุที่มา |
| IBM Plex Sans และ IBM Plex Sans Thai | ฟอนต์ในหน้าเว็บ | IBM / [Fontsource](https://fontsource.org/fonts/ibm-plex-sans-thai/) | OFL-1.1 | ข้อความสัญญาอนุญาตอยู่ที่ [IBM Plex Sans](public/fonts/IBM-Plex-Sans-LICENSE.txt) และ [IBM Plex Sans Thai](public/fonts/IBM-Plex-Sans-Thai-LICENSE.txt) |
| **TSL-51** Thai Sign Language Dataset | ข้อมูลเทรนโมเดลภาษามือไทย 51 คำ + null | Namonpas Viriyaroj, Chulalongkorn University ([HF](https://huggingface.co/datasets/Namonpas/thai-sign-language-tsl51)) | **CC BY-NC-SA 4.0** | ระบุที่มา, ห้ามใช้เชิงพาณิชย์, งานดัดแปลงต้องใช้สัญญาเดียวกัน |
| **TSL-ONE / TSL-ONE-S** (keypoints `TSL-ONE-Pose.7z`) | ข้อมูลเทรนเพิ่ม 184 คำ (รวมพยัญชนะ/สระสะกดนิ้ว) จากผู้แสดง 29 คน | ทีม TSL-ONE ([tsl-one.github.io](https://tsl-one.github.io/), งานตีพิมพ์ IEEE “TSL-ONE-S: A Real-World Thai Sign Language Dataset With Deep Learning Benchmarks”) | ไม่มีไฟล์ LICENSE ในรีโป; หน้าเว็บระบุว่า **ให้ใช้ได้เพื่อการไม่แสวงหากำไร โดยกรอกฟอร์มขอใช้** | ใช้เฉพาะในเครื่องเพื่อการศึกษา ไม่แจกจ่ายข้อมูลหรือโมเดลที่เทรนจากข้อมูลนี้; **ผู้ใช้ควรกรอกฟอร์มขอใช้ที่หน้าเว็บ TSL-ONE** และอ้างอิงงานตีพิมพ์ |
| พจนานุกรม [th-sl.com](https://www.th-sl.com/search-by-word/) | ใช้ดูท่าที่ถูกต้องเท่านั้น | สมาคมคนหูหนวกแห่งประเทศไทย | ลิขสิทธิ์ของสมาคม | ไม่ได้ดาวน์โหลดหรือใช้วิดีโอเทรน |
| โมเดล TSL ที่เทรนเอง (`tsl51.onnx`) | แปลท่าภาษามือไทย | สร้างจาก TSL-51 ด้วย `ml/train_tsl.py` | **CC BY-NC-SA 4.0** (งานดัดแปลงของ TSL-51) | ถ้าแจกจ่าย ต้องใช้สัญญาเดียวกันและระบุที่มา |
| `public/samples/tsl-sawasdee.mp4` | คลิปทดสอบท่า “สวัสดี” | TSL-51 `videos/user_sign` (ผู้สร้างชุดข้อมูลถือสิทธิ์ส่วนนี้เอง) | **CC BY-NC-SA 4.0** | คงข้อความสิทธิ์นี้ไว้กับไฟล์ |
| ASL Signs 1st-place model (`model.tflite`) | แปลท่า ASL 250 คำ | Hoyeol Sohn ([Kaggle solution](https://www.kaggle.com/code/hoyso48/1st-place-solution-inference)); สำเนาที่ [sign/kaggle-asl-signs-1st-place](https://huggingface.co/sign/kaggle-asl-signs-1st-place) | MIT | ระบุที่มา |
| **ThonburianTTS** (megaF5 checkpoint + เสียงอ้างอิง `assets/000000.wav`) | เสียงพูดไทย/อังกฤษ | Looloo Technology, WordSense, Biomedical and Data Lab มหาวิทยาลัยมหิดล ([HF](https://huggingface.co/biodatlab/ThonburianTTS), [GitHub](https://github.com/biodatlab/thonburian-tts)) | โมเดล **CC BY-NC-SA 4.0**, โค้ด MIT | ระบุที่มาและอ้างอิงงานตีพิมพ์ด้านล่าง, ห้ามใช้เชิงพาณิชย์ |
| F5-TTS (แพ็กเกจ `f5-tts`) | โค้ดรันโมเดลเสียง | Yushen Chen et al. ([SWivid/F5-TTS](https://github.com/SWivid/F5-TTS)) | MIT (โค้ด) | ระบุที่มา |
| Vocos vocoder (`charactr/vocos-mel-24khz`) | แปลง mel เป็นคลื่นเสียง | charactr | MIT | ระบุที่มา |
| Ollama + Qwen3 4B Instruct | เรียบเรียงคำเป็นประโยค | Ollama (MIT), Alibaba Qwen (Apache-2.0) | MIT / Apache-2.0 | — |
| Llama 3.2 3B / Gemma 3 4B (ตัวเลือก) | ใช้เปรียบเทียบ | Meta / Google | Llama 3.2 Community License / Gemma Terms of Use | อ่านเงื่อนไขก่อนเผยแพร่ |
| คลิปทดสอบ `thumbs-up.mp4`, `face-and-thumb.mp4`, `wave-hello.mp4` | ทดสอบโหมดท่าพื้นฐาน | linoyts (วิดีโอสังเคราะห์ Wan 2.1) | Apache-2.0 | ดู [docs/SAMPLE_VIDEO.md](docs/SAMPLE_VIDEO.md) |
| Windows System.Speech | เสียงอังกฤษสำรอง | Microsoft | ส่วนหนึ่งของ Windows | — |

## ข้อควรระวังเรื่องข้อมูลใน TSL-51

dataset card ระบุว่าส่วน **expert primary** (ล่าม 2 คน) ใช้ภายใต้ fair use เพื่อการวิจัย และส่วน **expert scraped** มาจากเว็บไซต์ของสมาคมคนหูหนวกแห่งประเทศไทย ราชบัณฑิตยสภา และ TTRS ซึ่งอาจมีข้อจำกัดลิขสิทธิ์ โปรเจกต์นี้ใช้เพียง **landmark** (พิกัดจุด ไม่ใช่วิดีโอ) จากส่วนเหล่านี้เพื่อเทรนในเครื่องสำหรับงานการศึกษา และไม่ได้แจกจ่ายข้อมูลดังกล่าวซ้ำ

## การอ้างอิง

```bibtex
@dataset{tsl51_2024,
  title  = {TSL-51: Thai Sign Language Dataset},
  author = {Namonpas Viriyaroj},
  year   = {2026},
  url    = {https://huggingface.co/datasets/Namonpas/thai-sign-language-tsl51}
}

@inproceedings{thonburiantts2025,
  author    = {Aung, Thura and Sriwirote, Panyut and Thavornmongkol, Thanachot and Pipatsrisawat, Knot and Achakulvisut, Titipat and Aung, Zaw Htet},
  title     = {ThonburianTTS: Enhancing Neural Flow Matching Models for Authentic Thai Text-to-Speech},
  booktitle = {2025 20th International Joint Symposium on Artificial Intelligence and Natural Language Processing (iSAI-NLP)},
  year      = {2025},
  doi       = {10.1109/iSAI-NLP66160.2025.11320472}
}
```

การแข่งขัน Google – Isolated Sign Language Recognition (Kaggle, 2023): <https://www.kaggle.com/competitions/asl-signs>
