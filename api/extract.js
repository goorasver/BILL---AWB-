// Vercel 서버리스 함수 — Gemini 호출 (키는 서버 환경변수에만 보관, 브라우저에 노출 안 됨)
// 요청: POST /api/extract  body={ base64, mime }
// 응답: 추출된 JSON 객체

const GEM_PROMPT = `You extract fields from a freight document (air waybill / commercial invoice / packing list).
Return ONLY a JSON object, no markdown. Keys (use "" if unknown):
awb_no, invoice_no, carrier, flight, onboard, departure, via_to, by, destination,
shipper, consignee, notify, marks, description, hs_code, package, gross_wt,
tel, zip, email, eori, tax_id, form_no, ba_no,
is_mawb (true if a master air waybill number = 3-digit airline prefix + 8 digits appears at top-right, else false),
dest_country (destination ISO 2-letter country code).
shipper/consignee/notify = full multi-line name+address block. description = item names joined by newline.
tel/zip/email = the consignee's.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  try {
    const { base64, mime } = req.body || {};
    if (!base64) { res.status(400).json({ error: "no file (base64 missing)" }); return; }

    const key = process.env.GEMINI_API_KEY;
    if (!key) { res.status(500).json({ error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다 (Vercel > Settings > Environment Variables)" }); return; }
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const body = {
      contents: [{ parts: [
        { text: GEM_PROMPT },
        { inline_data: { mime_type: mime || "application/pdf", data: base64 } }
      ]}],
      generationConfig: { response_mime_type: "application/json", temperature: 0 }
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const t = await r.text();
      res.status(502).json({ error: "Gemini " + r.status, detail: t.slice(0, 400) });
      return;
    }
    const j = await r.json();
    const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let obj;
    try { obj = JSON.parse(txt); } catch (e) { obj = { _raw: txt }; }
    res.status(200).json(obj);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
}

// 큰 PDF도 받도록 본문 크기 제한 상향
export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };
