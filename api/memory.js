// 화주별 입력방식 기억 저장소 (Vercel KV / Upstash Redis REST API 사용)
// KV를 연결하면 팀 전체가 공유. 연결 안 돼 있으면 {ok:false} 를 돌려주고 화면이 브라우저 저장으로 대체.
//
// GET  /api/memory            → { ok:true, data:{ 화주키: {필드:값} } }
// POST /api/memory { key, rec }        → 저장(병합)
// POST /api/memory { key, remove:true } → 삭제

const STORE_KEY = "bill_shipper_memory";

function cfg() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

async function kvGet(c) {
  const r = await fetch(`${c.url}/get/${STORE_KEY}`, {
    headers: { Authorization: `Bearer ${c.token}` }
  });
  if (!r.ok) return {};
  const j = await r.json().catch(() => null);
  if (!j || j.result == null) return {};
  try { return JSON.parse(j.result) || {}; } catch (e) { return {}; }
}

async function kvSet(c, obj) {
  const r = await fetch(`${c.url}/set/${STORE_KEY}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "text/plain" },
    body: JSON.stringify(obj)
  });
  return r.ok;
}

export default async function handler(req, res) {
  const c = cfg();
  if (!c) { res.status(200).json({ ok: false, reason: "not-configured" }); return; }
  try {
    if (req.method === "GET") {
      res.status(200).json({ ok: true, data: await kvGet(c) });
      return;
    }
    if (req.method === "POST") {
      const { key, rec, remove } = req.body || {};
      if (!key) { res.status(400).json({ ok: false, reason: "no key" }); return; }
      const data = await kvGet(c);
      if (remove) delete data[key]; else data[key] = rec || {};
      const ok = await kvSet(c, data);
      res.status(200).json({ ok, count: Object.keys(data).length });
      return;
    }
    res.status(405).json({ ok: false, reason: "method not allowed" });
  } catch (e) {
    res.status(500).json({ ok: false, reason: String((e && e.message) || e) });
  }
}
