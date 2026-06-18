// OCR route — parse an Italian store receipt (or bank notification) with
// GPT-4o Vision. Returns the receipt header (store/total/date/method) plus the
// list of purchased products with prices, categorized for later analytics.
// The data is returned to the client to pre-fill the form; saving happens via
// POST /api/receipts. Protected.
import { Router } from "express";
import multer from "multer";
import OpenAI from "openai";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { PRODUCT_CATEGORIES, normalizeCategory } from "../lib/categories.js";

const router = Router();
router.use(authMiddleware);

// Keep the image in memory; we forward it to OpenAI, never to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

const SYSTEM_PROMPT =
  "Analizza questo scontrino (o notifica bancaria) italiano ed estrai i dati in JSON con questa struttura ESATTA:\n" +
  "{\n" +
  '  "store": string | null,        // nome del negozio/esercente\n' +
  '  "total": number,               // totale pagato, sempre positivo\n' +
  '  "date": string | null,         // data in formato ISO (YYYY-MM-DD)\n' +
  '  "method": "CASH"|"POS"|"CARD"|"TRANSFER" | null,\n' +
  '  "items": [\n' +
  "    {\n" +
  '      "rawName": string,         // nome esatto come appare sullo scontrino\n' +
  '      "canonicalName": string,   // nome normalizzato, minuscolo, esteso e leggibile (es. "latte parzialmente scremato")\n' +
  '      "category": string,        // UNA tra le categorie ammesse\n' +
  '      "quantity": number,\n' +
  '      "unitPrice": number | null,\n' +
  '      "totalPrice": number\n' +
  "    }\n" +
  "  ]\n" +
  "}\n" +
  "Categorie ammesse (usa SOLO queste, mai inventarne altre): " +
  PRODUCT_CATEGORIES.join(", ") +
  ".\n" +
  "Regole: se un campo non è leggibile usa null; canonicalName DEVE essere coerente per lo stesso prodotto " +
  "anche se rawName cambia tra scontrini diversi (stesso prodotto → stesso canonicalName); " +
  "category DEVE essere esattamente una delle categorie ammesse. " +
  "Se l'immagine è una notifica bancaria senza elenco prodotti, restituisci items: []. " +
  "Rispondi SOLO con il JSON, nessun testo aggiuntivo.";

// POST /api/ocr/parse — multipart/form-data, field "image"
router.post("/parse", upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Immagine mancante (campo 'image')" });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY non configurata" });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Estrai i dati e l'elenco prodotti da questo scontrino." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: "Risposta OCR non in formato JSON", raw });
    }

    // Normalize items: clamp categories to the allowed list, default quantity.
    const items = Array.isArray(parsed.items)
      ? parsed.items.map((it) => ({
          rawName: it.rawName ?? null,
          canonicalName: it.canonicalName ?? it.rawName ?? null,
          category: normalizeCategory(it.category),
          quantity: it.quantity ?? 1,
          unitPrice: it.unitPrice ?? null,
          totalPrice: it.totalPrice,
        }))
      : [];

    res.json({
      store: parsed.store ?? null,
      total: parsed.total ?? null,
      date: parsed.date ?? null,
      method: parsed.method ?? null,
      items,
      // Backward-compatible fields so the existing transaction form can pre-fill.
      amount: parsed.total ?? null,
      type: "EXPENSE",
      description: parsed.store ?? null,
    });
  } catch (err) {
    console.error("[ocr] error:", err);
    res.status(502).json({ error: "Errore durante l'analisi OCR", detail: err.message });
  }
});

export default router;
