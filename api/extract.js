// Vercel 서버리스 함수 — Gemini 호출 (키는 서버 환경변수에만 보관, 브라우저에 노출 안 됨)
// 요청: POST /api/extract  body={ base64, mime }
// 응답: 추출된 JSON 객체 ( { used_model, ...fields } )

const GEM_PROMPT = `You extract fields from a freight document (air waybill / commercial invoice / packing list) for a forwarder.
Return ONLY a JSON object, no markdown. Use "" if unknown. Keys:
awb_no, invoice_no, destination, via_to, by,
shipper, consignee, notify   (each = full multi-line name+address block, verbatim),
description   (the FULL goods description text exactly as written, do NOT summarize or pick items; keep line breaks),
marks   (shipping marks — see the SHIPPING MARK rule below),
shipper_name, shipper_city, shipper_street, shipper_zip, shipper_country, shipper_tel, shipper_email,
consignee_name, consignee_state, consignee_city, consignee_street, consignee_zip, consignee_country, consignee_tel, consignee_email, consignee_taxid,
notify_name, notify_city, notify_street, notify_zip, notify_country,
eori, form_no, ba_no,
is_mawb (true if a master air waybill number = 3-digit airline prefix + 8 digits appears at top-right, else false),
dest_country (destination ISO 2-letter country code).
IMPORTANT — labels and positions differ by company. Match by MEANING, never by exact label text or cell position:
- shipper (sender/exporter): SHIPPER, CONSIGNOR, EXPORTER, SELLER, SUPPLIER, VENDOR, FROM, 송하인, 수출자, 발송인
- consignee (receiver/importer): CONSIGNEE, SHIP TO, DELIVER TO, DELIVERY ADDRESS, IMPORTER, BUYER, SOLD TO, MESSRS, 수하인, 수입자
- notify: NOTIFY, NOTIFY PARTY, ALSO NOTIFY, 통지처
Priority when several appear together:
1) An explicit SHIPPER / CONSIGNEE / NOTIFY label always wins over SELLER / BUYER / SOLD TO.
2) On a commercial invoice with only SELLER and BUYER, treat SELLER as shipper and BUYER as consignee.
3) If SOLD TO and SHIP TO both exist, SHIP TO is the consignee.
4) Ignore the forwarder's own company (KOOYANG / 국양로지텍 / KOOYANG LOGITECH) — never use it as shipper/consignee/notify.
invoice_no: the document's invoice/reference number. Labels vary a lot — accept any of:
INVOICE NO, INVOICE NUMBER, INV NO, INV#, No., NO. :, P/I NO, PROFORMA INVOICE NO,
COMMERCIAL INVOICE NO, ORDER NO, PO NO, PURCHASE ORDER, REFERENCE NO, REF NO, 송장번호, 인보이스번호.
Many documents have NO invoice number at all — in that case return "" (do NOT use the AWB number, a date, or any other number as a substitute).

SHIPPING MARK rule: transcribe the mark as text. If the text is drawn INSIDE a diamond/rhombus,
put the text on its own line and "IN DIA" on the next line. Example — HOHODANG inside a diamond:
HOHODANG
IN DIA
For any other shape, just transcribe the text with no shape notation.
Keep any other mark lines (port, case numbers, C/NO. etc.) on following lines, verbatim.

If a value truly is not in the document, return "" — never guess or invent.

Rules: shipper_city = shipper's city FULL name (e.g. SHENZHEN, SHANGHAI, HONG KONG).
consignee_state = state/province ABBREVIATION (e.g. NY, CA for US). country = ISO 2-letter code (CN, US, ...).
tel/zip/email in top-level and consignee_* = the CONSIGNEE's.
eori = EORI number = 2-letter country code + digits (e.g. IT07607410961, DE123456789). Look for a token matching that pattern.
consignee_taxid = consignee's customs id: for EU put the EORI there, for Indonesia the NPWP, for Bangladesh the BIN, etc.`;

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

async function generate(model, key, base64, mime, text) {
  const url = `${BASE}/models/${model}:generateContent?key=${key}`;
  // 엑셀은 CSV 텍스트로, PDF/이미지는 파일 그대로 전달
  const parts = [{ text: GEM_PROMPT }];
  if (text) parts.push({ text: "\n--- DOCUMENT (spreadsheet converted to CSV) ---\n" + text });
  else parts.push({ inline_data: { mime_type: mime || "application/pdf", data: base64 } });
  const body = {
    contents: [{ parts }],
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
    const { base64, mime, text } = req.body || {};
    if (!base64 && !text) { res.status(400).json({ error: "no input (base64/text missing)" }); return; }

    const key = process.env.GEMINI_API_KEY;
    if (!key) { res.status(500).json({ error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다 (Vercel > Settings > Environment Variables)" }); return; }

    // 사용할 모델 선택 (환경변수 우선, 없으면 자동 조회)
    let model = await pickModel(key);

    // 선택 모델 호출, 404(NOT_FOUND)면 후보들로 폴백
    const fallbacks = [model, "gemini-flash-latest", "gemini-2.0-flash", "gemini-flash-lite-latest"];
    let r, usedModel, lastText = "";
    for (const m of fallbacks) {
      if (!m) continue;
      r = await generate(m, key, base64, mime, text);
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
