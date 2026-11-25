/* وسيط مرصاد: يستقبل الطلب من الموقع ويضيف مفتاح Gemini من الخادم، فلا يظهر المفتاح في كود الموقع.
   المتغيرات (Settings > Variables and Secrets في Cloudflare):
     GEMINI_API_KEY  (Secret)  مفتاح Gemini
     ALLOWED_ORIGIN  (Text)    عنوان موقعك، مثل  https://USERNAME.github.io  (يمكن وضع أكثر من عنوان بفاصلة) */
const MAX_BYTES = 6 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
    const originOk = allowed.length === 0 || allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': originOk && origin ? origin : (allowed[0] || '*'),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    const reply = (status, message) => new Response(JSON.stringify({ error: { message } }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply(405, 'method not allowed');
    if (!originOk) return reply(403, 'origin not allowed');
    if (!env.GEMINI_API_KEY) return reply(500, 'server key is missing');

    const raw = await request.text();
    if (raw.length > MAX_BYTES) return reply(413, 'payload too large');
    let payload;
    try { payload = JSON.parse(raw); } catch (e) { return reply(400, 'invalid json'); }
    const model = String(payload.model || '');
    if (!/^gemini-[a-z0-9.\-]{2,50}$/.test(model)) return reply(400, 'invalid model');
    if (!payload.body || !Array.isArray(payload.body.contents)) return reply(400, 'invalid body');

    const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: payload.body.contents, generationConfig: payload.body.generationConfig }),
    });
    return new Response(upstream.body, { status: upstream.status, headers: { ...cors, 'Content-Type': 'application/json' } });
  },
};
