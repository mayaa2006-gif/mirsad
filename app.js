/* مرصاد الخصوصية - منطق الأداة (يعمل داخل المتصفح) */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CAT = { phone_number: 'رقم جوال', password: 'كلمة مرور', email: 'بريد إلكتروني', ip_address: 'عنوان شبكة (IP)', national_id: 'رقم هوية', address_or_location: 'عنوان أو موقع', logo_or_badge: 'شعار أو بطاقة', license_plate: 'لوحة سيارة', person_name: 'اسم شخص', other: 'معلومة أخرى' };
  const SEV = { high: ['عالية', 'var(--bad)', 30], medium: ['متوسطة', 'var(--warn)', 15], low: ['منخفضة', '#4a8fd0', 5] };

  /* ---------- قراءة EXIF من ملف JPEG ---------- */
  function readExif(buf) {
    const out = {};
    try {
      const v = new DataView(buf);
      if (v.getUint16(0) !== 0xFFD8) return out;
      let off = 2;
      while (off + 4 < v.byteLength) {
        const marker = v.getUint16(off); off += 2;
        if (marker === 0xFFDA) break;
        const len = v.getUint16(off);
        if (marker === 0xFFE1 && v.getUint32(off + 2) === 0x45786966) { parseTiff(v, off + 8, out); break; }
        off += len;
      }
    } catch (e) { /* ملف بلا بيانات صالحة */ }
    return out;
  }
  function parseTiff(v, start, out) {
    const le = v.getUint16(start) === 0x4949;
    const u16 = (o) => v.getUint16(o, le), u32 = (o) => v.getUint32(o, le);
    const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
    function readIFD(rel) {
      const base = start + rel, n = u16(base), tags = {};
      for (let i = 0; i < n; i++) {
        const e = base + 2 + i * 12, tag = u16(e), type = u16(e + 2), cnt = u32(e + 4);
        const size = (SZ[type] || 1) * cnt;
        const p = size > 4 ? start + u32(e + 8) : e + 8;
        let val;
        if (type === 2) { let s = ''; for (let k = 0; k < cnt - 1; k++) s += String.fromCharCode(v.getUint8(p + k)); val = s.trim(); }
        else if (type === 3) { val = []; for (let k = 0; k < cnt; k++) val.push(u16(p + 2 * k)); }
        else if (type === 4) { val = []; for (let k = 0; k < cnt; k++) val.push(u32(p + 4 * k)); }
        else if (type === 5) { val = []; for (let k = 0; k < cnt; k++) { const d = u32(p + 8 * k + 4); val.push(d ? u32(p + 8 * k) / d : 0); } }
        else continue;
        tags[tag] = val;
      }
      return tags;
    }
    const ifd0 = readIFD(u32(start + 4));
    if (ifd0[0x010F]) out.make = ifd0[0x010F];
    if (ifd0[0x0110]) out.model = ifd0[0x0110];
    if (ifd0[0x0131]) out.software = ifd0[0x0131];
    if (ifd0[0x0132]) out.datetime = ifd0[0x0132];
    if (ifd0[0x8769]) { try { const ex = readIFD(ifd0[0x8769][0]); if (ex[0x9003]) out.datetime = ex[0x9003]; } catch (e) {} }
    if (ifd0[0x8825]) {
      try {
        const g = readIFD(ifd0[0x8825][0]);
        if (g[2] && g[4]) {
          const deg = (a) => a[0] + a[1] / 60 + a[2] / 3600;
          let lat = deg(g[2]), lon = deg(g[4]);
          if (g[1] && g[1] === 'S') lat = -lat; if (g[3] && g[3] === 'W') lon = -lon;
          out.gps = { lat, lon };
        }
      } catch (e) {}
    }
  }
  function techFindings(ex) {
    const f = [];
    if (ex.gps) f.push({ type: 'الموقع الجغرافي', detail: ex.gps.lat.toFixed(2) + ', ' + ex.gps.lon.toFixed(2), risk: 50, why: 'يكشف مكان التقاط الصورة، وقد يدل على السكن أو العمل.' });
    if (ex.make || ex.model) f.push({ type: 'نوع الجهاز', detail: ((ex.make || '') + ' ' + (ex.model || '')).trim(), risk: 10, why: 'يساعد المهاجم على تخمين نوع الجهاز وثغراته.' });
    if (ex.datetime) f.push({ type: 'تاريخ ووقت التصوير', detail: ex.datetime, risk: 10, why: 'يكشف أوقات وجود صاحب الصورة في المكان.' });
    if (ex.software) f.push({ type: 'البرنامج المستخدم', detail: ex.software, risk: 5, why: 'معلومة تقنية إضافية عن الجهاز.' });
    return f;
  }

  /* ---------- الذكاء الاصطناعي (Gemini) ---------- */
  const PROMPT = `You are a privacy and cybersecurity analyst.
Task: find sensitive information that is VISIBLE in this image or screenshot.
Audience: a non-technical person who wants to know if it is safe to share the image.
Report only what you can actually see. Do not guess. If nothing sensitive is visible, return an empty items list.
Categories allowed: phone_number, password, email, ip_address, national_id, address_or_location, logo_or_badge, license_plate, person_name, other.
Output: JSON only, exactly this shape:
{"items":[{"category":"...","text_seen":"the exact text or a short description","severity":"high|medium|low","why_ar":"one short Arabic sentence explaining the risk","box_2d":[ymin,xmin,ymax,xmax] or null}],"attacker_view_ar":["short Arabic sentences: what an attacker could do using ONLY what is visible"],"summary_ar":"one Arabic sentence"}
box_2d uses coordinates normalized from 0 to 1000.
Constraints: Arabic text must be simple, gender-neutral and short. Never include precise coordinates of real places.`;

  function getKey() { try { return sessionStorage.getItem('mirsad_key') || ''; } catch (e) { return ''; } }
  function getModel() { try { return sessionStorage.getItem('mirsad_model') || 'gemini-flash-latest'; } catch (e) { return 'gemini-flash-latest'; } }

  function shrink(img, max) {
    const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }
  async function analyze(img, key) {
    const body = { contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: shrink(img, 1600) } }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } };
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(getModel()) + ':generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error((data.error && data.error.message) || ('خطأ ' + res.status));
    let text = data.candidates && data.candidates[0] && data.candidates[0].content.parts.map((p) => p.text || '').join('');
    if (!text) throw new Error('لم يرجع النموذج نتيجة');
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const j = JSON.parse(text);
    const items = (Array.isArray(j.items) ? j.items : []).map((i) => ({
      category: CAT[i.category] ? i.category : 'other', text_seen: i.text_seen || '', severity: SEV[i.severity] ? i.severity : 'low', why_ar: i.why_ar || '',
      box: Array.isArray(i.box_2d) && i.box_2d.length === 4 && i.box_2d.every((n) => typeof n === 'number' && n >= 0 && n <= 1000) ? i.box_2d : null }));
    return { items, attacker: Array.isArray(j.attacker_view_ar) ? j.attacker_view_ar : [], summary: j.summary_ar || '' };
  }

  /* ---------- التنظيف والتغطية ---------- */
  function cleanCanvas(img, items) {
    const r = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    let covered = 0; g.fillStyle = '#000';
    items.forEach((i) => { if (i.box) { const [y1, x1, y2, x2] = i.box, p = 4; g.fillRect(x1 / 1000 * c.width - p, y1 / 1000 * c.height - p, (x2 - x1) / 1000 * c.width + 2 * p, (y2 - y1) / 1000 * c.height + 2 * p); covered++; } });
    return { canvas: c, covered };
  }

  /* ---------- العرض ---------- */
  const color = (s) => (s >= 85 ? 'var(--ok)' : s >= 50 ? 'var(--warn)' : 'var(--bad)');
  const level = (s) => (s >= 85 ? 'آمن' : s >= 50 ? 'يحتاج انتباهًا' : 'لا يُنصح بنشرها');
  const ring = (n, lab) => `<div class="sc"><div class="lb">${lab}</div><div class="rg" style="background:conic-gradient(${color(n)} ${n}%,var(--line) 0)"><span style="color:${color(n)}">${n}</span></div><span class="bd" style="background:${color(n)}">${level(n)}</span></div>`;
  const techCards = (t) => t.length ? t.map((f) => `<div class="it"><b>${esc(f.type)}</b> <span class="v">${esc(f.detail)}</span><p>${esc(f.why)}</p></div>`).join('') : '<div class="none">لا توجد بيانات مخفية في الصورة</div>';
  const aiCards = (items) => items.length ? items.map((i) => { const s = SEV[i.severity]; return `<div class="it" style="border-right-color:${s[1]}"><b>${CAT[i.category]}</b><span class="ch" style="background:${s[1]}">خطورة ${s[0]}</span><span class="v">${esc(i.text_seen)}</span><p>${esc(i.why_ar)}</p></div>`; }).join('') : '<div class="none">لم يكتشف الذكاء الاصطناعي بيانات حساسة ظاهرة</div>';

  let current = null;
  async function run(file) {
    const results = $('#results'); results.hidden = false;
    results.innerHTML = '<div class="busy"><div class="spin"></div>جارٍ الفحص...</div>';
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const buf = await file.arrayBuffer();
    const tech = techFindings(readExif(buf));
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('تعذر قراءة الصورة')); img.src = url; }).catch((e) => { results.innerHTML = `<div class="warnbox">${esc(e.message)}. استخدم صورة JPG أو PNG.</div>`; throw e; });
    const key = getKey();
    const token = (current = {});
    draw(tech, null, key ? 'pending' : 'nokey', img, url);
    if (!key) return;
    try {
      const ai = await analyze(img, key);
      if (current === token) draw(tech, ai, 'ok', img, url);
    } catch (e) { if (current === token) draw(tech, null, 'error:' + e.message, img, url); }
  }
  function draw(tech, ai, status, img, url) {
    const items = ai ? ai.items : [];
    const tRisk = tech.reduce((a, f) => a + f.risk, 0), aRisk = items.reduce((a, i) => a + SEV[i.severity][2], 0);
    const before = 100 - Math.min(tRisk + aRisk, 100);
    const { canvas, covered } = cleanCanvas(img, items);
    const left = items.filter((i) => !i.box).reduce((a, i) => a + SEV[i.severity][2], 0);
    const after = 100 - Math.min(left, 100);
    let aiHtml;
    if (status === 'pending') aiHtml = '<div class="busy"><div class="spin"></div>الذكاء الاصطناعي يحلل محتوى الصورة...</div>';
    else if (status === 'nokey') aiHtml = '<div class="warnbox">لم تُدخل مفتاح Gemini، فعُرض الفحص التقني فقط. أضف المفتاح من الأعلى لتفعيل الذكاء الاصطناعي.</div>';
    else if (status.indexOf('error:') === 0) aiHtml = `<div class="warnbox">تعذر الاتصال بـ Gemini: ${esc(status.slice(6))}<br>تأكد من المفتاح واسم النموذج في الإعدادات المتقدمة.</div>`;
    else aiHtml = aiCards(items);
    const atk = ai && (ai.attacker.length || ai.summary) ? `<details class="atkd"><summary>عين المهاجم: اعرض ما يراه المهاجم</summary><ul>${ai.attacker.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p>${esc(ai.summary)}</p></details>` : '';
    $('#results').innerHTML = `
      <div class="scores">${ring(before, 'قبل التنظيف')}<div class="ar">&#8592;</div>${ring(after, 'بعد التنظيف')}</div>
      <div class="stats" style="margin-top:14px"><div class="stat"><b>${tech.length + items.length}</b><span>تسريب مرصود</span></div><div class="stat"><b>${covered}</b><span>عنصر مغطّى</span></div><div class="stat"><b>${after >= before ? '+' + (after - before) : after - before}</b><span>تحسّن في الدرجة</span></div></div>
      <h3 class="rh">1) البيانات المخفية (فحص تقني)</h3>${techCards(tech)}
      <h3 class="rh">2) ما يظهر في الصورة (ذكاء اصطناعي)</h3>${aiHtml}${atk}
      <h3 class="rh">3) قبل وبعد</h3>
      <div class="g2"><div class="cd" style="padding:12px;text-align:center"><b>الأصلية</b><img src="${url}" alt="الصورة الأصلية" style="width:100%;border-radius:12px;margin-top:8px"></div><div class="cd" style="padding:12px;text-align:center"><b>المنظّفة</b><img src="${canvas.toDataURL('image/jpeg', 0.92)}" alt="الصورة المنظفة" style="width:100%;border-radius:12px;margin-top:8px"></div></div>
      <div class="cta" style="justify-content:center"><a class="btn p" id="dl" href="#">نزّل النسخة المنظّفة</a></div>
      <p class="note">حُذفت البيانات المخفية من النسخة المنظّفة. التغطية تعتمد على دقة تحديد الذكاء الاصطناعي للأماكن، فراجع النتيجة قبل النشر.</p>`;
    $('#dl').addEventListener('click', (e) => { e.preventDefault(); canvas.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'mirsad_clean.jpg'; a.click(); }, 'image/jpeg', 0.92); });
  }

  /* ---------- الواجهة ---------- */
  function init() {
    const input = $('#file'), drop = $('#drop');
    if (!input) return;
    input.addEventListener('change', () => { if (input.files[0]) run(input.files[0]).catch(() => {}); });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) run(f).catch(() => {}); });
    const kf = $('#key'), mf = $('#model'), st = $('#keystate');
    kf.value = getKey(); mf.value = getModel(); if (getKey()) st.textContent = '✔ المفتاح محفوظ لهذه الجلسة';
    $('#savekey').addEventListener('click', () => { try { sessionStorage.setItem('mirsad_key', kf.value.trim()); sessionStorage.setItem('mirsad_model', mf.value.trim() || 'gemini-flash-latest'); } catch (e) {} st.textContent = kf.value.trim() ? '✔ تم الحفظ لهذه الجلسة فقط' : 'تم حذف المفتاح'; });
    const box = $('#samples');
    (window.SAMPLES || []).forEach((s) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sample'; b.innerHTML = `<img src="${s.data}" alt=""><span>${esc(s.label)}</span>`;
      b.addEventListener('click', async () => { const blob = await (await fetch(s.data)).blob(); run(new File([blob], s.file, { type: 'image/jpeg' })).catch(() => {}); });
      box.appendChild(b);
    });
  }
  window.Mirsad = { readExif, techFindings, run, analyze, getKey };
  document.addEventListener('DOMContentLoaded', init);
})();
