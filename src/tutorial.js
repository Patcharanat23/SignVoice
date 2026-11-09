const GUIDES = {
  login: [
    { target: '.showcase-hero', title: 'SignVoice ทำอะไรได้', body: 'เว็บอ่านท่ามือจากกล้อง ช่วยจัดคำเป็นข้อความ และพูดประโยคที่คุณตรวจแล้ว' },
    { target: '#carousel', title: 'ดูตัวอย่างหน้าจอ', body: 'กดลูกศรหรือปุ่มใต้ภาพเพื่อดูหน้าพูด หน้าจัดข้อความ การสอนท่า และการส่งเสียงเข้าแอปประชุม' },
    { target: '.tabs', title: 'เข้าสู่ระบบหรือสมัคร', body: 'มีบัญชีแล้วเลือก “เข้าสู่ระบบ” หากใช้ครั้งแรกให้เลือก “สมัครสมาชิก” ก่อน' },
    { target: '#username', title: 'กรอกชื่อผู้ใช้', body: 'ใช้ตัวอักษรอังกฤษ ตัวเลข จุด หรือขีดล่าง ความยาว 3–32 ตัว' },
    { target: '#password', title: 'กรอกรหัสผ่าน', body: 'บัญชีใหม่ต้องมีอย่างน้อย 8 ตัว และมีทั้งตัวอักษรกับตัวเลข' },
    { target: '#submit', title: 'เริ่มใช้งาน', body: 'หลังเข้าสู่ระบบ กดไอคอนรูปหนังสือบนแถบเมนูด้านบนเพื่อเปิดคำแนะนำทีละจุดของแต่ละหน้า' }
  ],
  speak: [
    { target: '.view-switch', title: 'เลือกหน้าที่อยากใช้', body: 'หน้าพูดใช้สื่อสารแบบเต็มจอ ส่วนสอนท่าใช้ตรวจคำ แก้ข้อความ และเพิ่มท่าใหม่' },
    { target: ['#speak-start', '.speak-controls'], title: 'เริ่มจากกล้อง', body: 'กดเริ่มกล้องและอนุญาตให้เว็บใช้กล้อง จัดแสงให้พอและให้เห็นใบหน้ากับมือชัด ๆ' },
    { target: '#camera-stage', title: 'ทำท่าทีละคำ', body: 'หันหน้าเข้ากล้อง ทำท่าให้ครบ แล้วลดมือลงเพื่อจบคำ ระบบจึงจะเริ่มอ่านคำถัดไป' },
    { target: '#hud-sign', title: 'ดูผลที่ระบบอ่านได้', body: 'คำที่อ่านได้จะปรากฏบนภาพ หากคำยังไม่ตรง ไปหน้า “สอนท่า” เพื่อแก้ข้อความก่อนพูด' },
    { target: '.speak-hint', title: 'สั่งงานด้วยท่ามือ', body: 'ยกมือเหนือหัวค้างประมาณ 1 วินาทีเพื่อพูด หรือชูสองนิ้วแล้วพับลง 2 ครั้งเพื่อลบคำล่าสุด' },
    { target: ['#output-button', '.view-switch'], title: 'เลือกทางออกของเสียง', body: 'เสียงจะออกลำโพงเครื่องนี้ตามปกติ ถ้าใช้แอปประชุม ให้กด “เสียงออก” แล้วเลือกไมค์เสมือน' }
  ],
  teach: [
    { target: '.view-switch', title: 'นี่คือหน้าจัดคำและสอนท่า', body: 'สลับไป “หน้าพูด” เมื่อต้องการใช้กล้องเต็มจอ และกลับมาหน้านี้เพื่อตรวจคำก่อนพูด' },
    { target: '#camera-button', title: 'เปิดกล้อง', body: 'ให้กล้องเห็นใบหน้าและมือชัด ๆ ทำท่าทีละคำ แล้วลดมือลงเพื่อให้ระบบแยกคำ' },
    { target: '#teach-word', title: 'เลือกคำที่จะสอน', body: 'เลือกคำที่มีอยู่ หรือพิมพ์คำใหม่ทางซ้ายเพื่อเพิ่มท่าที่อยากใช้' },
    { target: '#teach-record', title: 'บันทึกท่า', body: 'กดเริ่มบันทึก ทำท่าเดิมซ้ำหลายครั้ง และลดมือลงทุกครั้งเมื่อจบท่า' },
    { target: '#token-list', title: 'ตรวจคำที่อ่านได้', body: 'คำจากกล้องจะมาตรงนี้ กด × ที่คำหากต้องการลบ หรือใช้ปุ่มย้อนคำล่าสุดด้านล่าง' },
    { target: ['.try-phrases', '#sentence'], title: 'ลองใช้ได้แม้ไม่เปิดกล้อง', body: 'กดข้อความตัวอย่าง หรือพิมพ์และแก้ประโยคเองได้ก่อนสั่งพูด' },
    { target: '#language-select', title: 'เลือกภาษา', body: 'เลือกภาษาไทยหรืออังกฤษก่อนพูด ระบบจะใช้ภาษาที่เลือกสำหรับข้อความและเสียง' },
    { target: '.compose-actions', title: 'เรียงประโยค แล้วพูด', body: 'ตัวช่วยเรียงประโยคใช้เมื่อมีโมเดลในเครื่อง แต่คุณกด “พูดข้อความนี้” จากข้อความที่แก้เองได้เสมอ' },
    { target: ['#output-button', '.view-switch'], title: 'กำหนดเสียงออก', body: 'กด “เสียงออก” หากต้องการเลือกอุปกรณ์หรือส่งเสียงเข้าแอปประชุมผ่านไมค์เสมือน' }
  ],
  admin: [
    { target: '.view-switch', title: 'สลับไปทดสอบระบบได้', body: 'หน้าพูดใช้ทดลองสื่อสาร ส่วนหน้าสอนท่าใช้เพิ่มคำและฝึกให้ระบบจำท่า' },
    { target: '#stats', title: 'ดูภาพรวม', body: 'ตัวเลขด้านบนบอกจำนวนผู้ใช้ การแปล ตัวอย่างท่า และรายการที่รอตรวจ' },
    { target: '#users', title: 'จัดการผู้ใช้', body: 'ดูสิทธิ์และสถานะบัญชี แล้วเลือกจัดการเฉพาะบัญชีที่ต้องการ' },
    { target: '#proposals', title: 'ตรวจท่าที่ผู้ใช้เสนอ', body: 'คลิกรายการที่รอตรวจเพื่อดูท่าก่อนอนุมัติหรือปฏิเสธ' },
    { target: '.preview-box', title: 'ดูตัวอย่างก่อนตัดสินใจ', body: 'ภาพตัวอย่างช่วยให้เห็นการเคลื่อนไหวของท่า เลือกตรวจทีละรายการได้' },
    { target: '.two-col', title: 'ดูปัญหาที่เกิดซ้ำ', body: 'คำที่ถูกแก้บ่อยช่วยบอกว่าท่าไหนยังสับสน ส่วนบันทึกการเข้าใช้ช่วยติดตามการใช้งาน' }
  ]
};

const visibleTarget = (step) => {
  for (const selector of Array.isArray(step.target) ? step.target : [step.target]) {
    const element = document.querySelector(selector);
    if (element && element.getBoundingClientRect().width && element.getBoundingClientRect().height) return element;
  }
  return null;
};

let updateTutorial;
const guideSteps = (view, isAdmin) => {
  const steps = GUIDES[view].map((step) => ({ ...step }));
  if (view === 'teach') {
    steps[3].body = isAdmin
      ? 'กดเริ่มบันทึก ทำท่าเดิมซ้ำหลายครั้ง ลดมือลงทุกครั้ง แล้วกด “ฝึกให้จำท่า” เมื่อมีตัวอย่างเพียงพอ'
      : 'กดเริ่มบันทึก ทำท่าเดิมซ้ำหลายครั้ง และลดมือลงทุกครั้ง ท่าที่ส่งจะรอผู้ดูแลตรวจ';
  }
  return steps;
};

export function initTutorial(view, { isAdmin = false } = {}) {
  const launch = document.getElementById('tutorial-open');
  if (!launch || !GUIDES[view]) return;
  if (launch.dataset.tutorialReady) { updateTutorial?.(view, isAdmin); return; }
  launch.dataset.tutorialReady = 'true';
  let steps = guideSteps(view, isAdmin);

  const layer = document.createElement('div');
  layer.className = 'tutorial-layer';
  layer.hidden = true;
  layer.innerHTML = `
    <div class="tutorial-spotlight" aria-hidden="true"></div>
    <section class="tutorial-card" role="dialog" aria-labelledby="tutorial-title" aria-describedby="tutorial-body" tabindex="-1">
      <div class="tutorial-card-top"><span class="tutorial-progress"></span><button class="tutorial-close" type="button" aria-label="ปิดคำแนะนำ">×</button></div>
      <h2 id="tutorial-title"></h2><p id="tutorial-body"></p>
      <div class="tutorial-actions"><button class="tutorial-back" type="button">ย้อนกลับ</button><button class="tutorial-next" type="button">ถัดไป</button></div>
    </section>`;
  document.body.append(layer);
  const card = layer.querySelector('.tutorial-card');
  const spotlight = layer.querySelector('.tutorial-spotlight');
  const back = layer.querySelector('.tutorial-back');
  const next = layer.querySelector('.tutorial-next');
  let index = 0;
  let currentTarget = null;

  const position = () => {
    if (layer.hidden || !currentTarget) return;
    const rect = currentTarget.getBoundingClientRect();
    const pad = 5;
    spotlight.style.left = `${Math.max(0, rect.left - pad)}px`;
    spotlight.style.top = `${Math.max(0, rect.top - pad)}px`;
    spotlight.style.width = `${Math.min(innerWidth - rect.left + pad, rect.width + pad * 2)}px`;
    spotlight.style.height = `${rect.height + pad * 2}px`;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const left = Math.max(12, Math.min(rect.left, innerWidth - width - 12));
    const below = rect.bottom + 18;
    const above = rect.top - height - 18;
    const top = below + height <= innerHeight - 12 ? below : above >= 12 ? above : Math.max(12, innerHeight - height - 12);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  };
  const render = () => {
    const step = steps[index];
    currentTarget = visibleTarget(step);
    if (!currentTarget) { close(); return; }
    layer.querySelector('.tutorial-progress').textContent = `${{ login: 'เริ่มต้น', speak: 'หน้าพูด', teach: 'สอนท่า', admin: 'แอดมิน' }[view]} · ${index + 1}/${steps.length}`;
    layer.querySelector('#tutorial-title').textContent = step.title;
    layer.querySelector('#tutorial-body').textContent = step.body;
    back.disabled = index === 0;
    next.textContent = index === steps.length - 1 ? 'เสร็จแล้ว' : 'ถัดไป';
    currentTarget.scrollIntoView({ block: 'center', inline: 'nearest' });
    requestAnimationFrame(position);
  };
  const close = () => {
    layer.hidden = true;
    currentTarget = null;
    launch.focus();
  };
  const open = () => {
    index = 0;
    layer.hidden = false;
    render();
    card.focus();
  };
  launch.addEventListener('click', open);
  back.addEventListener('click', () => { if (index > 0) { index--; render(); } });
  next.addEventListener('click', () => { if (index < steps.length - 1) { index++; render(); } else close(); });
  layer.querySelector('.tutorial-close').addEventListener('click', close);
  document.addEventListener('keydown', (event) => { if (!layer.hidden && event.key === 'Escape') close(); });
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  updateTutorial = (nextView, nextIsAdmin) => {
    if (!layer.hidden) close();
    view = nextView;
    steps = guideSteps(nextView, nextIsAdmin);
  };

}
