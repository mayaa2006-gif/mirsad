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

  const STORE = 'mirsad_eval_v1';
  const loadStore = () => { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { return {}; } };
  const saveStore = () => { try { const o = {}; files.forEach((f) => { if (res[f.name] && res[f.name].ai) o[f.name] = [...res[f.name].ai]; }); localStorage.setItem(STORE, JSON.stringify(o)); } catch (e) {} };
  async function entry(f, ai, err) {
    const real = new Set((truth[f.name] || []).filter((c) => GT.includes(c)));
    const ex = window.Mirsad.readExif(await f.arrayBuffer());
    return { real, tech: new Set(ex.gps ? ['gps_location'] : []), ai, err: err || '' };
  }

  async function one(f) {
    let { real, tech } = await entry(f, null);
    let ai = null, err = '';
    let quota = false;
    for (let a = 0; a < 3; a++) {
      try {
        const r = await window.Mirsad.analyze(await loadImg(f), window.Mirsad.getKey());
        ai = new Set(r.items.map((i) => i.category).filter((c) => GT.includes(c))); err = ''; quota = false; break;
      } catch (e) {
        err = String(e.message || e);
        quota = /quota|429|exhaust|rate limit/i.test(err);
        const transient = quota || /overload|unavailable|503|retry/i.test(err);
        if (!transient) break;
        const m = err.match(/retry in ([\d.]+)\s*(s|m|h)?/i);
        let wait = m ? parseFloat(m[1]) * ({ s: 1, m: 60, h: 3600 }[(m[2] || 's').toLowerCase()]) : 20;
        if (/per ?day|daily/i.test(err) || wait > 90) { break; }       // حد يومي: لا فائدة من الانتظار
        $('#prog').textContent = `حد الطلبات في الدقيقة: ننتظر ${Math.ceil(wait + 2)} ثانية ثم نعيد المحاولة (${f.name})...`;
        await sleep((wait + 2) * 1000);
      }
    }
    res[f.name] = { real, tech, ai, err, quota };
    saveStore(); render();
    return quota;
  }

  async function runPending() {
    if (busy) return;
    if (!window.Mirsad.getKey()) { $('#info').innerHTML = '<span style="color:var(--bad)">أدخلي مفتاح Gemini في صفحة «جرّب الأداة» أولًا ثم ارجعي هنا.</span>'; return; }
    busy = true; $('#start').disabled = true; $('#retry').hidden = true;
    const stored = loadStore();
    for (const f of files) { if (stored[f.name] && !(res[f.name] && res[f.name].ai)) res[f.name] = await entry(f, new Set(stored[f.name])); }
    render();
    const todo = files.filter((f) => !res[f.name] || !res[f.name].ai);
    let hits = 0, stopped = false;
    for (let n = 0; n < todo.length; n++) {
      $('#bar').style.width = (n / todo.length * 100) + '%'; $('#prog').textContent = `جارٍ فحص ${n + 1} من ${todo.length}...`;
      const q = await one(todo[n]);
      hits = q ? hits + 1 : 0;
      if (hits >= 2) { stopped = true; break; }
      await sleep(GAP);
    }
    $('#bar').style.width = '100%'; busy = false; $('#start').disabled = false;
    const failed = files.filter((f) => res[f.name] && !res[f.name].ai).length;
    $('#prog').textContent = stopped ? 'توقفنا لأن حد الطلبات المجاني وصل. النتائج الناجحة محفوظة، غيّري النموذج أو المفتاح (فوق) ثم اضغطي «إعادة المحاولة» وتكمل من حيث وقفت.' : (failed ? `انتهت الجولة، وتعذر تحليل ${failed} صورة.` : 'اكتمل القياس بنجاح');
    $('#retry').hidden = !failed; $('#retry').textContent = `إعادة محاولة الصور الفاشلة (${failed})`;
    $('#csv').hidden = false; render();
  }

  function render() {
    $('#table tbody').innerHTML = files.map((f) => {
      const r = res[f.name]; if (!r) return `<tr><td>${esc(f.name)}</td><td colspan="4">—</td></tr>`;
      const both = new Set([...r.tech, ...(r.ai || [])]);
      return `<tr><td>${esc(f.name)}</td><td>${esc(names(r.real))}</td><td>${esc(names(r.tech))}</td><td>${r.ai ? esc(names(both)) : '—'}</td><td>${r.ai ? 'تم' : 'تعذر: ' + (r.quota ? 'حد الطلبات المجاني' : esc(r.err.slice(0, 60)))}</td></tr>`;
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

  const ss = (k) => { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } };
  $('#ekey').value = ss('mirsad_key'); $('#emodel').value = ss('mirsad_model') || 'gemini-flash-latest';
  $('#esave').addEventListener('click', () => { try { sessionStorage.setItem('mirsad_key', $('#ekey').value.trim()); sessionStorage.setItem('mirsad_model', $('#emodel').value.trim() || 'gemini-flash-latest'); } catch (e) {} $('#esaved').textContent = '✔ تم الحفظ'; });
  $('#ereset').addEventListener('click', () => { try { localStorage.removeItem(STORE); } catch (e) {} res = {}; render(); $('#esaved').textContent = 'مُسحت النتائج المحفوظة'; });
  $('#start').addEventListener('click', runPending);
  $('#retry').addEventListener('click', runPending);
  $('#csv').addEventListener('click', () => {
    const rows = files.filter((f) => res[f.name]).map((f) => { const r = res[f.name], both = new Set([...r.tech, ...(r.ai || [])]); return [f.name, names(r.real), names(r.tech), r.ai ? names(both) : '', r.ai ? 'تم' : r.err]; });
    const csv = '\ufeffimage,real,tech_only,tech_plus_ai,status\n' + rows.map((r) => r.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = 'results.csv'; a.click();
  });
})();
