/* مرصاد الخصوصية - صفحة قياس الدقة: التقني وحده مقابل التقني + الذكاء الاصطناعي */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const GT = ['phone_number', 'password', 'email', 'ip_address', 'national_id', 'gps_location'];
  const AR = { phone_number: 'جوال', password: 'كلمة مرور', email: 'بريد', ip_address: 'IP', national_id: 'هوية', gps_location: 'موقع' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let files = [], truth = null, rows = [];

  function loadImg(file) {
    return new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(file); });
  }
  const names = (set) => [...set].map((c) => AR[c] || c).join('، ') || '—';

  $('#files').addEventListener('change', async (e) => {
    const all = [...e.target.files];
    const gt = all.find((f) => f.name.toLowerCase() === 'ground_truth.json');
    files = all.filter((f) => /\.(jpe?g|png)$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
    truth = null;
    if (gt) { try { truth = JSON.parse(await gt.text()); } catch (x) { truth = null; } }
    const ok = files.length && truth;
    $('#info').innerHTML = ok ? `✔ ${files.length} صورة + ملف الإجابات جاهزة.` : '<span style="color:var(--bad)">لازم تختارين الصور وملف ground_truth.json معًا.</span>';
    $('#start').disabled = !ok;
  });

  $('#start').addEventListener('click', async () => {
    if (!window.Mirsad.getKey()) { $('#info').innerHTML = '<span style="color:var(--bad)">أدخلي مفتاح Gemini في صفحة «جرّب الأداة» أولًا ثم ارجعي هنا.</span>'; return; }
    $('#start').disabled = true; rows = [];
    const T = { tech: [0, 0, 0], both: [0, 0, 0] }; let fullT = 0, fullB = 0, failed = 0;
    $('#table tbody').innerHTML = ''; $('#sum').hidden = true;
    for (let n = 0; n < files.length; n++) {
      const f = files[n], real = new Set((truth[f.name] || []).filter((c) => GT.includes(c)));
      $('#bar').style.width = (n / files.length * 100) + '%'; $('#prog').textContent = `جارٍ فحص ${n + 1} من ${files.length}...`;
      const ex = window.Mirsad.readExif(await f.arrayBuffer());
      const tech = new Set(ex.gps ? ['gps_location'] : []);
      let ai = new Set(), status = 'تم';
      for (let a = 0; a < 3; a++) {
        try { const r = await window.Mirsad.analyze(await loadImg(f), window.Mirsad.getKey()); ai = new Set(r.items.map((i) => i.category).filter((c) => GT.includes(c))); status = 'تم'; break; }
        catch (e) { status = 'تعذر'; await sleep(4000); }
      }
      if (status === 'تعذر') failed++;
      const both = new Set([...tech, ...ai]);
      [['tech', tech], ['both', both]].forEach(([k, found]) => {
        T[k][0] += [...real].filter((c) => found.has(c)).length; T[k][1] += [...found].filter((c) => !real.has(c)).length; T[k][2] += [...real].filter((c) => !found.has(c)).length;
      });
      if ([...real].every((c) => tech.has(c))) fullT++; if ([...real].every((c) => both.has(c))) fullB++;
      rows.push([f.name, names(real), names(tech), names(both), status]);
      $('#table tbody').insertAdjacentHTML('beforeend', `<tr><td>${esc(f.name)}</td><td>${esc(names(real))}</td><td>${esc(names(tech))}</td><td>${esc(names(both))}</td><td>${status}</td></tr>`);
      await sleep(1500);
    }
    $('#bar').style.width = '100%'; $('#prog').textContent = 'اكتمل القياس';
    const m = (k) => { const [tp, fp, fn] = T[k]; return { rec: tp + fn ? Math.round(tp / (tp + fn) * 100) : 0, pre: tp + fp ? Math.round(tp / (tp + fp) * 100) : 0, fp }; };
    const a = m('tech'), b = m('both');
    $('#sum').hidden = false;
    $('#sum').innerHTML = `<table class="cmp"><tr><th></th><th>الفحص التقني وحده</th><th>التقني + الذكاء الاصطناعي</th></tr>
      <tr><td><b>نسبة الكشف عن البيانات الحساسة</b></td><td>${a.rec}%</td><td>${b.rec}%</td></tr>
      <tr><td><b>دقة النتائج</b></td><td>${a.pre}%</td><td>${b.pre}%</td></tr>
      <tr><td><b>إنذارات كاذبة</b></td><td>${a.fp}</td><td>${b.fp}</td></tr>
      <tr><td><b>صور كُشفت بياناتها كاملة</b></td><td>${fullT} من ${files.length}</td><td>${fullB} من ${files.length}</td></tr></table>
      ${failed ? `<p class="note">تنبيه: تعذر تحليل ${failed} صورة بسبب أخطاء اتصال، وحُسبت كأن الذكاء لم يكتشف فيها شيئًا.</p>` : ''}
      <p class="note">الفئات المحتسبة: جوال، كلمة مرور، بريد، عنوان IP، هوية، موقع جغرافي.</p>`;
    $('#csv').hidden = false; $('#start').disabled = false;
  });

  $('#csv').addEventListener('click', () => {
    const csv = '\ufeffimage,real,tech_only,tech_plus_ai,status\n' + rows.map((r) => r.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = 'results.csv'; a.click();
  });
})();
