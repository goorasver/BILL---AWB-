// Vercel 서버리스 함수 — Gemini 호출 (키는 서버 환경변수에만 보관, 브라우저에 노출 안 됨)
// 요청: POST /api/extract  body={ base64, mime }
// 응답: 추출된 JSON 객체 ( { used_model, ...fields } )

const GEM_PROMPT = `You extract fields from a freight document (air waybill / commercial invoice / packing list).
Return ONLY a JSON object, no markdown. Keys (use "" if unknown):
awb_no, invoice_no, carrier, flight, onboard, departure, via_to, by, destination,
shipper, consignee, notify, marks, description, hs_code, package, gross_wt,
tel, zip, email, eori, tax_id, form_no, ba_no,
is_mawb (true if a master air waybill number = 3-digit airline prefix + 8 digits appears at top-right, else false),
dest_country (destination ISO 2-letter country code).
shipper/consignee/notify = full multi-line name+address block. description = item names joined by newline.
tel/zip/email = the consignee's.`;

const BASE = "https://generativelanguage.googleapis.com/v1beta";

// 이 키로 실제 generateContent 가능한 모델을 조회해서 flash 계열을 우선 선택
async function pickModel(key) {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL;
  try {
    const r = await fetch(`${BASE}/models?key=${key}&pageSize=100`);
    if (!r.ok) return "gemini-flash-latest";
    const j = await r.json();
    const models = (j.models || []).filter(m =>
      (m.supportedGenerationMethods || []).includes("generateContent"));
    const score = m => {
      const n = m.name.replace("models/", "");
      let s = 0;
      if (/flash/.test(n)) s += 10;            // flash 우선 (빠르고 저렴)
      if (/latest/.test(n)) s += 3;            // latest 별칭 선호
      if (/lite/.test(n)) s -= 2;
      if (/preview|exp|thinking/.test(n)) s -= 6; // 미리보기/실험판 회피
      if (/vision|embedding|aqa|imagen/.test(n)) s -= 50;
      const ver = (n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1];
      if (ver) s += parseFloat(ver);           // 버전 높을수록 소폭 가산
      return s;
    };
    models.sort((a, b) => score(b) - score(a));
    return models[0] ? models[0].name.replace("models/", "") : "gemini-flash-latest";
  } catch (e) {
    return "gemini-flash-latest";
  }
}

async function generate(model, key, base64, mime) {
  const url = `${BASE}/models/${model}:generateContent?key=${key}`;
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
  return r;
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  try {
    const { base64, mime } = req.body || {};
    if (!base64) { res.status(400).json({ error: "no file (base64 missing)" }); return; }

    const key = process.env.GEMINI_API_KEY;
    if (!key) { res.status(500).json({ error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다 (Vercel > Settings > Environment Variables)" }); return; }

    // 사용할 모델 선택 (환경변수 우선, 없으면 자동 조회)
    let model = await pickModel(key);

    // 선택 모델 호출, 404(NOT_FOUND)면 후보들로 폴백
    const fallbacks = [model, "gemini-flash-latest", "gemini-2.0-flash", "gemini-flash-lite-latest"];
    let r, usedModel, lastText = "";
    for (const m of fallbacks) {
      if (!m) continue;
      r = await generate(m, key, base64, mime);
      if (r.ok) { usedModel = m; break; }
      lastText = await r.text();
      // 모델 없음이 아니면(권한/키 문제 등) 더 시도해도 소용없음 → 중단
      if (r.status !== 404 && !/NOT_FOUND/.test(lastText)) break;
    }
    if (!r || !r.ok) {
      res.status(502).json({ error: "Gemini " + (r ? r.status : "?"), detail: lastText.slice(0, 400) });
      return;
    }

    const j = await r.json();
    const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let obj;
    try { obj = JSON.parse(txt); } catch (e) { obj = { _raw: txt }; }
    obj.used_model = usedModel;
    res.status(200).json(obj);
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
