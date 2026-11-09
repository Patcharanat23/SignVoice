# คลิปทดสอบท่าชูนิ้วโป้ง

ไฟล์ตัวอย่างสองคลิปมาจากชุดข้อมูล [linoyts/wan_thumbs_up_gesture](https://huggingface.co/datasets/linoyts/wan_thumbs_up_gesture) บน Hugging Face ชุดข้อมูลระบุสิทธิ์ Apache-2.0 และอธิบายว่าเป็นวิดีโอสังเคราะห์ด้วย Wan 2.1 ผู้สร้างชุดข้อมูลคือ linoyts

คลิป public/samples/thumbs-up.mp4 มาจาก [0.mp4](https://huggingface.co/datasets/linoyts/wan_thumbs_up_gesture/blob/main/0.mp4) ยาวประมาณ 5.4 วินาที เห็นมือชูนิ้วโป้งค้างบนพื้นหลังเรียบ ผลทดสอบบนเครื่องพัฒนา: MediaPipe จำแนก Thumb_Up ได้ถึง 80% ในเฟรมที่สังเกต และระบบเพิ่มคำว่า “ใช่” ในประโยคภาษาไทย

คลิป public/samples/face-and-thumb.mp4 มาจาก [8.mp4](https://huggingface.co/datasets/linoyts/wan_thumbs_up_gesture/blob/main/8.mp4) เห็นใบหน้ากับนิ้วโป้งพร้อมกัน ระบบตรวจ face cue เป็น smile และ raised brows ในบางเฟรม รวมทั้งจำแนก Thumb_Up ในบางเฟรม แต่ท่าไม่ค้างนิ่งพอให้ระบบเพิ่มคำในรอบทดสอบนี้

แอปเล่นคลิปที่ 0.6 เท่าเพื่อให้ตัวตรวจท่าค้างมีเวลาประมวลผล ผลทั้งสองเป็นการทดสอบคลิปตัวอย่าง ไม่ใช่ค่าความแม่นยำทั่วไป เปิดแอปแล้วกด “คลิปทดสอบมือ” หรือ “คลิปทดสอบใบหน้า” ถ้าต้องการทดสอบคลิปอื่น ใช้ปุ่ม “เลือกวิดีโอทดสอบ” ไฟล์ MP4 หรือ WebM จะถูกอ่านในเบราว์เซอร์และไม่อัปโหลดออกนอกเครื่อง

## คลิปโบกมือ

`public/samples/wave-hello.mp4` มาจาก [linoyts/wan_waving_hands: 3.mp4](https://huggingface.co/datasets/linoyts/wan_waving_hands/blob/main/3.mp4) ซึ่งเป็นวิดีโอสังเคราะห์ Wan 2.1 และระบุสิทธิ์ Apache-2.0 บน [หน้า dataset](https://huggingface.co/datasets/linoyts/wan_waving_hands) คลิปแสดงคนโบกมือและใบหน้ายิ้ม ผลทดสอบก่อนแก้ระบบโบกมือ: พบ `Open_Palm` แต่ไม่มีคำเพิ่ม หลังแก้การติดตามปลายนิ้วและยอมให้ classifier หลุดชั่วคราว: เพิ่ม “สวัสดี” **หนึ่งครั้ง** พร้อม cue `smile` ใน token ดู [ภาพทดสอบ](wave-test.png) ได้

คลิปนี้เป็นท่าโบกทักทายทั่วไป ไม่ใช่การประเมินความแม่นยำของภาษามือไทย ระบบปัจจุบันยังไม่ได้ใช้โมเดล TSL‑51 หรือโมเดล ASL ที่เก็บไว้ใน `research/models/`
