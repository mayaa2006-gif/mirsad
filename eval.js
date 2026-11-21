/* مرصاد الخصوصية - قياس الدقة: التقني وحده مقابل التقني + الذكاء الاصطناعي
   يراعي حدود النسخة المجانية: تباطؤ بين الطلبات، وإعادة محاولة ذكية، واستئناف الصور الفاشلة فقط. */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const GT = ['phone_number', 'password', 'email', 'ip_address', 'national_id', 'gps_location'];
  const AR = { phone_number: 'جوال', password: 'كلمة مرور', email: 'بريد', ip_address: 'IP', national_id: 'هوية', gps_location: 'موقع' };
  const GAP = 7000;           // فاصل بين الطلبات (مللي ثانية)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const names = (set) => [...set].map((c) => AR[c] || c).join('، ') || '—';
  let files = [], truth = null, res = {}, busy = false;

  const loadImg = (file) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(file); });

  $('#files').addEventListener('change', async (e) => {
    const all = [...e.target.files];
    const gt = all.find((f) => f.name.toLowerCase() === 'ground_truth.json');
    files = all.filter((f) => /\.(jpe?g|png)$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
    truth = null; res = {};
    if (gt) { try { truth = JSON.parse(await gt.text()); } catch (x) { truth = null; } }
    const ok = files.length && truth;
    $('#info').innerHTML = ok ? `✔ ${files.length} صورة + ملف الإجابات جاهزة.` : '<span style="color:var(--bad)">لازم تختارين الصور وملف ground_truth.json معًا.</span>';
    $('#start').disabled = !ok; render();
  });

  $('#useready').addEventListener('click', () => {
    const D = window.DATASET; if (!D) return;
    files = Object.keys(D.images).sort().map((n) => { const b = atob(D.images[n].split(',')[1]), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new File([u], n, { type: 'image/jpeg' }); });
    truth = D.truth; res = {};
    $('#info').innerHTML = `✔ ${files.length} صورة اختبار جاهزة (بيانات وهمية معروفة مسبقًا).`; $('#start').disabled = false; render();
  });

  async function one(f) {
    const real = new Set((truth[f.name] || []).filter((c) => GT.includes(c)));
    const ex = window.Mirsad.readExif(await f.arrayBuffer());
    const tech = new Set(ex.gps ? ['gps_location'] : []);
    let ai = null, err = '';
    for (let a = 0; a < 4; a++) {
      try {
        const r = await window.Mirsad.analyze(await loadImg(f), window.Mirsad.getKey());
        ai = new Set(r.items.map((i) => i.category).filter((c) => GT.includes(c))); err = ''; break;
      } catch (e) {
        err = String(e.message || e);
        if (!/429|quota|rate|exhaust|retry|overload|unavailable|503/i.test(err)) break;   // خطأ دائم: لا فائدة من الإعادة
        const m = err.match(/retry in ([\d.]+)s/i);
        $('#prog').textContent = `حد الطلبات: ننتظر قليلًا ثم نعيد المحاولة (${f.name})...`;
        await sleep(Math.min(70000, m ? (parseFloat(m[1]) + 2) * 1000 : 20000));
      }
    }
    res[f.name] = { real, tech, ai, err };
    render();
  }

  async function runPending() {
    if (busy) return;
    if (!window.Mirsad.getKey()) { $('#info').innerHTML = '<span style="color:var(--bad)">أدخلي مفتاح Gemini في صفحة «جرّب الأداة» أولًا ثم ارجعي هنا.</span>'; return; }
    busy = true; $('#start').disabled = true; $('#retry').hidden = true;
    const todo = files.filter((f) => !res[f.name] || !res[f.name].ai);
    for (let n = 0; n < todo.length; n++) {
      $('#bar').style.width = (n / todo.length * 100) + '%'; $('#prog').textContent = `جارٍ فحص ${n + 1} من ${todo.length}...`;
      await one(todo[n]); await sleep(GAP);
    }
    $('#bar').style.width = '100%'; busy = false; $('#start').disabled = false;
    const failed = files.filter((f) => res[f.name] && !res[f.name].ai).length;
    $('#prog').textContent = failed ? `انتهت الجولة، وتعذر تحليل ${failed} صورة.` : 'اكتمل القياس بنجاح';
    $('#retry').hidden = !failed; $('#retry').textContent = `إعادة محاولة الصور الفاشلة (${failed})`;
    $('#csv').hidden = false; render();
  }

  function render() {
    $('#table tbody').innerHTML = files.map((f) => {
      const r = res[f.name]; if (!r) return `<tr><td>${esc(f.name)}</td><td colspan="4">—</td></tr>`;
      const both = new Set([...r.tech, ...(r.ai || [])]);
      return `<tr><td>${esc(f.name)}</td><td>${esc(names(r.real))}</td><td>${esc(names(r.tech))}</td><td>${r.ai ? esc(names(both)) : '—'}</td><td>${r.ai ? 'تم' : 'تعذر: ' + esc(r.err.slice(0, 70))}</td></tr>`;
    }).join('');
    const done = files.filter((f) => res[f.name] && res[f.name].ai);
    if (!done.length) { $('#sum').hidden = true; return; }
    const T = { tech: [0, 0, 0], both: [0, 0, 0] }; let fullT = 0, fullB = 0;
    done.forEach((f) => {
      const r = res[f.name], both = new Set([...r.tech, ...r.ai]);
      [['tech', r.tech], ['both', both]].forEach(([k, found]) => { T[k][0] += [...r.real].filter((c) => found.has(c)).length; T[k][1] += [...found].filter((c) => !r.real.has(c)).length; T[k][2] += [...r.real].filter((c) => !found.has(c)).length; });
      if ([...r.real].every((c) => r.tech.has(c))) fullT++; if ([...r.real].every((c) => both.has(c))) fullB++;
    });
    const m = (k) => { const [tp, fp, fn] = T[k]; return { rec: tp + fn ? Math.round(tp / (tp + fn) * 100) : 0, pre: tp + fp ? Math.round(tp / (tp + fp) * 100) : 0, fp }; };
    const a = m('tech'), b = m('both'), skipped = files.length - done.length;
    $('#sum').hidden = false;
    $('#sum').innerHTML = `<table class="cmp"><tr><th></th><th>الفحص التقني وحده</th><th>التقني + الذكاء الاصطناعي</th></tr>
      <tr><td><b>نسبة الكشف عن البيانات الحساسة</b></td><td>${a.rec}%</td><td>${b.rec}%</td></tr>
      <tr><td><b>دقة النتائج</b></td><td>${a.pre}%</td><td>${b.pre}%</td></tr>
      <tr><td><b>إنذارات كاذبة</b></td><td>${a.fp}</td><td>${b.fp}</td></tr>
      <tr><td><b>صور كُشفت بياناتها كاملة</b></td><td>${fullT} من ${done.length}</td><td>${fullB} من ${done.length}</td></tr></table>
      <p class="note">الأرقام محسوبة على ${done.length} صورة من ${files.length}${skipped ? ` (تعذر تحليل ${skipped}، ولم تدخل في الحساب. أعيدي المحاولة لإكمالها)` : ''}.</p>
      <p class="note">الفئات المحتسبة: جوال، كلمة مرور، بريد، عنوان IP، هوية، موقع جغرافي.</p>`;
  }

  $('#start').addEventListener('click', runPending);
  $('#retry').addEventListener('click', runPending);
  $('#csv').addEventListener('click', () => {
    const rows = files.filter((f) => res[f.name]).map((f) => { const r = res[f.name], both = new Set([...r.tech, ...(r.ai || [])]); return [f.name, names(r.real), names(r.tech), r.ai ? names(both) : '', r.ai ? 'تم' : r.err]; });
    const csv = '\ufeffimage,real,tech_only,tech_plus_ai,status\n' + rows.map((r) => r.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = 'results.csv'; a.click();
  });
})();
