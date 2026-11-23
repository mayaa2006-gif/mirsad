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
Bounding boxes: box_2d must enclose the ENTIRE sensitive text, including every word that belongs to it. For example, a neighborhood name, a landmark and a building number written together form ONE address and need ONE box that covers all of them. Never cut a word in half. If the text is Arabic (right-to-left), still enclose the whole phrase. Treat neighborhood, district, street, building and landmark names as address_or_location. Prefer one box per phrase or line, not one box per word.
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
  const MODELS = () => [getModel(), 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'].filter((x, i, arr) => x && arr.indexOf(x) === i);
  /* وسيط اختياري: إذا وُضع رابطه في config.js يعمل الذكاء الاصطناعي بدون مفتاح من المستخدم */
  const PROXY = () => String((window.MIRSAD_CONFIG && window.MIRSAD_CONFIG.proxyUrl) || '').trim();
  const aiReady = () => !!PROXY() || !!getKey();
  /* كل رسائل الخطأ تظهر بالعربي فقط، ولا يُعرض نص إنجليزي خام للمستخدم. يرجع [سبب مختصر، شرح كامل] */
  function errParts(msg) {
    msg = String(msg || '');
    const px = !!PROXY();
    const m0 = msg.match(/^\[(\d{3})\]\s*/); const code = m0 ? m0[1] : ''; if (m0) msg = msg.slice(m0[0].length);
    /* رسائل الوسيط (Cloudflare) وأخطاء الموقع الجغرافي: تُفحص أولًا */
    if (/origin not allowed/i.test(msg)) return ['عنوان الموقع غير مسموح', 'الوسيط يرفض الطلب لأن عنوان الموقع لا يطابق المكتوب في متغير ALLOWED_ORIGIN في Cloudflare. تأكد أنه مطابق تمامًا لعنوان موقعك بدون / في الآخر، مثل https://اسمك.github.io'];
    if (/server key is missing/i.test(msg)) return ['المفتاح غير مضاف في الوسيط', 'مفتاح Gemini غير موجود في إعدادات الوسيط. أضف المتغير GEMINI_API_KEY (من نوع Secret) في Cloudflare ثم اضغط Deploy.'];
    if (/invalid (model|body|json)|method not allowed/i.test(msg)) return ['طلب غير صالح', 'رفض الوسيط الطلب لأن صيغته غير صحيحة. تأكد أنك رفعت كل ملفات النسخة الأخيرة من الموقع.'];
    if (/location is not supported|not supported for the API use/i.test(msg)) return ['منطقة الخادم', 'خدمة Gemini لا تدعم المنطقة التي يعمل منها الوسيط حاليًا. أعد المحاولة بعد قليل، وإن تكرر فأبلغ فريق المشروع.'];
    if (/reported as leaked|leaked/i.test(msg)) return ['المفتاح مكشوف', 'عطّلت Google هذا المفتاح لأنه ظهر علنًا. أنشئ مفتاحًا جديدًا من مشروع جديد وضعه في Cloudflare.'];
    if (/quota|429|exhaust|rate.?limit|RESOURCE_EXHAUSTED/i.test(msg)) return ['حد الطلبات المجاني', 'وصل الحد المجاني للطلبات في خدمة Gemini. إن كان الحد في الدقيقة فانتظر دقيقة ثم أعد المحاولة، وإن كان يوميًا فيتجدد بعد منتصف الليل بتوقيت المحيط الهادئ (حوالي الحادية عشرة صباحًا بتوقيت السعودية).' + (px ? '' : ' ويمكنك أيضًا استخدام مفتاح من مشروع جديد، لأن الحد يُحسب على المشروع وليس على المفتاح.')];
    if (/api key not valid|API_KEY_INVALID|API key expired|PERMISSION_DENIED|permission|\b(401|403)\b/i.test(msg)) return [px ? 'إعداد الخدمة' : 'المفتاح غير صحيح', px ? 'تعذر الوصول إلى Gemini لأن مفتاح الخدمة غير صحيح أو غير مفعّل. أبلغ فريق المشروع بذلك.' : 'المفتاح غير صحيح أو منتهي أو غير مفعّل. تأكد أنك نسخته كاملًا من Google AI Studio.'];
    if (/not found|\b404\b|not supported/i.test(msg)) return ['اسم النموذج', 'اسم النموذج غير صحيح أو لم يعد متاحًا.' + (px ? '' : ' افتح «إعدادات متقدمة» وغيّره.')];
    if (/unavailable|overload|\b503\b|\b500\b|internal/i.test(msg)) return ['الخدمة مشغولة', 'خدمة Gemini مشغولة حاليًا. أعد المحاولة بعد لحظات.'];
    if (/Failed to fetch|NetworkError|network|Load failed|TypeError/i.test(msg)) return ['الاتصال', 'تعذر الاتصال بالإنترنت أو بخدمة الذكاء الاصطناعي. تأكد من اتصالك وأعد المحاولة.'];
    if (/SAFETY|blocked|PROHIBITED|BLOCK/i.test(msg)) return ['رفض النموذج', 'رفض النموذج تحليل هذه الصورة لأسباب تتعلق بالمحتوى.'];
    if (/payload|too large|\b413\b|exceeds/i.test(msg)) return ['حجم الصورة', 'حجم الصورة كبير على الخدمة. جرّب صورة أصغر.'];
    if (/JSON|Unexpected|SyntaxError|position/i.test(msg)) return ['رد غير مكتمل', 'وصل رد غير مكتمل من الذكاء الاصطناعي. أعد المحاولة.'];
    if (/[؀-ۿ]/.test(msg)) return [msg.slice(0, 60), msg];          // الرسالة عربية أصلًا
    return ['خطأ غير متوقع' + (code ? ' (' + code + ')' : ''), 'حدث خطأ غير متوقع أثناء التحليل' + (code ? ' (رمز الخطأ ' + code + ')' : '') + '. أعد المحاولة بعد قليل، وإن تكرر فالفحص التقني يعمل بدون الذكاء الاصطناعي.'];
  }
  const friendly = (msg) => errParts(msg)[1];
  const reason = (msg) => errParts(msg)[0];
  async function callModel(model, parts, key) {
    const body = { contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } };
    const res = PROXY()
      ? await fetch(PROXY(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, body }) })
      : await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('[' + res.status + '] ' + ((data.error && data.error.message) || ('خطأ ' + res.status)));
    return data;
  }
  /* يرسل الطلب ويجرّب النماذج البديلة، ويرجع JSON جاهزًا */
  async function generate(parts, key) {
    let data, last;
    for (const m of MODELS()) {
      try { data = await callModel(m, parts, key); break; }
      catch (e) { last = e; if (!/quota|429|exhaust|not found|404|not supported|unavailable|503|overload/i.test(String(e.message))) throw e; }
    }
    if (!data) throw last || new Error('تعذر التحليل');
    let text = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts.map((p) => p.text || '').join('');
    if (!text) throw new Error('لم يرجع النموذج نتيجة');
    text = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
    return JSON.parse(text);
  }
  function normalize(j) {
    j = j || {};
    const items = (Array.isArray(j.items) ? j.items : []).map((i) => ({
      category: CAT[i.category] ? i.category : 'other', text_seen: i.text_seen || '', severity: SEV[i.severity] ? i.severity : 'low', why_ar: i.why_ar || '',
      box: Array.isArray(i.box_2d) && i.box_2d.length === 4 && i.box_2d.every((n) => typeof n === 'number' && n >= 0 && n <= 1000) ? i.box_2d : null }));
    return { items, attacker: Array.isArray(j.attacker_view_ar) ? j.attacker_view_ar : [], summary: j.summary_ar || '' };
  }
  async function analyze(img, key) {
    return normalize(await generate([{ text: PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: shrink(img, 1600) } }], key));
  }
  /* عدة صور في طلب واحد: يوفّر عدد الطلبات (مهم للحد المجاني). يرجع مصفوفة بنفس ترتيب الصور. */
  const PROMPT_MULTI = `You are a privacy and cybersecurity analyst.
Task: for EACH numbered image below, find sensitive information that is VISIBLE in it.
Report only what you can actually see. Do not guess. Never mix findings between images. If nothing sensitive is visible in an image, return an empty items list for it.
Categories allowed: phone_number, password, email, ip_address, national_id, address_or_location, logo_or_badge, license_plate, person_name, other.
Output: JSON only, exactly this shape, with exactly one entry per image:
{"results":[{"image":1,"items":[{"category":"...","text_seen":"the exact text or a short description","severity":"high|medium|low","why_ar":"one short Arabic sentence","box_2d":[ymin,xmin,ymax,xmax] or null}],"attacker_view_ar":["short Arabic sentences"],"summary_ar":"one Arabic sentence"}]}
"image" is the image number given before each image. box_2d uses coordinates normalized from 0 to 1000 relative to that image.
Never include precise coordinates of real places.`;
  async function analyzeMany(imgs, key) {
    const parts = [{ text: PROMPT_MULTI }];
    imgs.forEach((img, i) => { parts.push({ text: 'Image ' + (i + 1) + ':' }); parts.push({ inline_data: { mime_type: 'image/jpeg', data: shrink(img, 1280) } }); });
    const j = await generate(parts, key);
    const list = Array.isArray(j.results) ? j.results : [];
    return imgs.map((_, i) => {
      const r = list.find((x) => Number(x && x.image) === i + 1) || (list.length === imgs.length ? list[i] : null);
      return r ? normalize(r) : null;   // null = الصورة لم ترجع في الرد
    });
  }

  /* ---------- التنظيف والتغطية ---------- */
  /* يدمج الصناديق المتجاورة على نفس السطر حتى لا تبقى كلمة بين صندوقين */
  function mergeBoxes(items) {
    const bs = items.filter((i) => i.box).map((i) => { const [y1, x1, y2, x2] = i.box; return [Math.min(y1, y2), Math.min(x1, x2), Math.max(y1, y2), Math.max(x1, x2)]; });
    let again = true;
    while (again) {
      again = false;
      for (let i = 0; i < bs.length && !again; i++) for (let j = i + 1; j < bs.length && !again; j++) {
        const a = bs[i], c = bs[j];
        const v = Math.min(a[2], c[2]) - Math.max(a[0], c[0]), minH = Math.min(a[2] - a[0], c[2] - c[0]);
        const gap = Math.max(a[1], c[1]) - Math.min(a[3], c[3]);
        if (v > 0.5 * minH && gap < 40) { bs[i] = [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[2]), Math.max(a[3], c[3])]; bs.splice(j, 1); again = true; }
      }
    }
    return bs;
  }
  function cleanCanvas(img, items) {
    const r = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    g.fillStyle = '#000';
    const px = Math.max(6, c.width * 0.008), py = Math.max(4, c.height * 0.005), boxes = mergeBoxes(items);
    boxes.forEach(([y1, x1, y2, x2]) => g.fillRect(x1 / 1000 * c.width - px, y1 / 1000 * c.height - py, (x2 - x1) / 1000 * c.width + 2 * px, (y2 - y1) / 1000 * c.height + 2 * py));
    return { canvas: c, covered: boxes.length };
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
    draw(tech, null, aiReady() ? 'pending' : 'nokey', img, url);
    if (!aiReady()) return;
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
    else if (status.indexOf('error:') === 0) aiHtml = `<div class="warnbox">${esc(friendly(status.slice(6)))}<br>الفحص التقني أعلاه يعمل بدون مفتاح، ويمكنك المتابعة به.</div>`;
    else aiHtml = aiCards(items);
    const atk = ai && (ai.attacker.length || ai.summary) ? `<details class="atkd"><summary>عين المهاجم: اعرض ما يراه المهاجم</summary><ul>${ai.attacker.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p>${esc(ai.summary)}</p></details>` : '';
    $('#results').innerHTML = `
      <div class="scores">${ring(before, 'قبل التنظيف')}<div class="ar">&#8592;</div>${ring(after, 'بعد التنظيف')}</div>
      <div class="stats" style="margin-top:14px"><div class="stat"><b>${tech.length + items.length}</b><span>تسريب مرصود</span></div><div class="stat"><b id="covcount">${covered}</b><span>عنصر مغطّى</span></div><div class="stat"><b>${after >= before ? '+' + (after - before) : after - before}</b><span>تحسّن في الدرجة</span></div></div>
      <h3 class="rh">1) البيانات المخفية (فحص تقني)</h3>${techCards(tech)}
      <h3 class="rh">2) ما يظهر في الصورة (ذكاء اصطناعي)</h3>${aiHtml}${atk}
      <h3 class="rh">3) قبل وبعد</h3>
      <div class="g2"><div class="cd" style="padding:12px;text-align:center"><b>الأصلية</b><img src="${url}" alt="الصورة الأصلية" style="width:100%;border-radius:12px;margin-top:8px"></div><div class="cd" style="padding:12px;text-align:center"><b>المنظّفة</b><div id="cleanbox"></div><div class="erow center" style="margin-top:10px"><button id="mdraw" class="btn s" type="button" style="padding:9px 16px;flex:0 1 auto">تغطية يدوية</button><button id="mundo" class="btn s" type="button" style="padding:9px 16px;flex:0 1 auto" disabled>تراجع</button></div><p id="mhint" class="note" style="margin:8px 0 0" hidden>اسحب بإصبعك أو بالفأرة على أي معلومة فاتت لتغطيتها.</p></div></div>
      <div class="cta" style="justify-content:center"><a class="btn p" id="dl" href="#">نزّل النسخة المنظّفة</a></div>
      <p class="note">حُذفت البيانات المخفية من النسخة المنظّفة. التغطية تعتمد على دقة تحديد الذكاء الاصطناعي للأماكن، فراجع النتيجة قبل النشر، وإن فاتت أي معلومة فاستخدم «تغطية يدوية».</p>`;
    setupManual(canvas, covered);
    $('#dl').addEventListener('click', (e) => { e.preventDefault(); canvas.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'mirsad_clean.jpg'; a.click(); }, 'image/jpeg', 0.92); });
  }

  /* تغطية يدوية: الصورة المنظّفة نفسها قابلة للرسم عليها، والتنزيل يأخذ آخر حالة */
  function setupManual(canvas, covered) {
    const box = $('#cleanbox'), btn = $('#mdraw'), undo = $('#mundo'), hint = $('#mhint');
    if (!box) return;
    canvas.style.cssText = 'width:100%;border-radius:12px;margin-top:8px;display:block';
    box.appendChild(canvas);
    const base = document.createElement('canvas'); base.width = canvas.width; base.height = canvas.height; base.getContext('2d').drawImage(canvas, 0, 0);
    const g = canvas.getContext('2d'), manual = []; let on = false, start = null, cur = null;
    const rect = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
    const fill = (r) => g.fillRect(r.x * canvas.width, r.y * canvas.height, r.w * canvas.width, r.h * canvas.height);
    function repaint() { g.drawImage(base, 0, 0); g.fillStyle = '#000'; manual.forEach(fill); if (start && cur) fill(rect(start, cur)); undo.disabled = !manual.length; $('#covcount').textContent = covered + manual.length; }
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
    btn.addEventListener('click', () => { on = !on; btn.textContent = on ? 'إنهاء التغطية اليدوية' : 'تغطية يدوية'; hint.hidden = !on; canvas.style.touchAction = on ? 'none' : 'auto'; canvas.style.cursor = on ? 'crosshair' : 'default'; });
    canvas.addEventListener('pointerdown', (e) => { if (!on) return; e.preventDefault(); canvas.setPointerCapture(e.pointerId); start = cur = pos(e); });
    canvas.addEventListener('pointermove', (e) => { if (!start) return; cur = pos(e); repaint(); });
    const finish = () => { if (!start) return; const r = rect(start, cur || start); if (r.w > 0.004 && r.h > 0.004) manual.push(r); start = cur = null; repaint(); };
    canvas.addEventListener('pointerup', finish); canvas.addEventListener('pointercancel', finish);
    undo.addEventListener('click', () => { manual.pop(); repaint(); });
  }

  /* ---------- الواجهة ---------- */
  function init() {
    if (PROXY()) { document.querySelectorAll('.needkey').forEach((e) => { e.style.display = 'none'; }); document.querySelectorAll('.proxyonly').forEach((e) => { e.hidden = false; }); }
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
  window.Mirsad = { readExif, techFindings, run, analyze, analyzeMany, getKey, aiReady, friendly, reason };
  document.addEventListener('DOMContentLoaded', init);
})();
