// OCR route — parse an Italian store receipt (or bank notification) with
// GPT-4o Vision. Accepts one OR several images (sections of the same long
// receipt) under the "images" field and reconstructs a single receipt with its
// product lines, categorized for later analytics. Protected.
import { Router } from "express";
import multer from "multer";
import OpenAI from "openai";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { PRODUCT_CATEGORIES, normalizeCategory } from "../lib/categories.js";

const router = Router();
router.use(authMiddleware);

// Keep images in memory; we forward them to OpenAI, never to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 12 }, // 10 MB each, up to 12
});

const SYSTEM_PROMPT =
  "Sei un trascrittore OCR di scontrini italiani. Il tuo unico compito è TRASCRIVERE " +
  "esattamente ciò che è stampato, non interpretarlo.\n" +
  "REGOLA NUMERO UNO: trascrivi ESATTAMENTE i numeri che vedi. NON stimare, NON arrotondare, " +
  "NON inventare prezzi. Se un prezzo non è leggibile con certezza, metti null nel campo prezzo: " +
  "è MOLTO meglio un null che un numero sbagliato.\n\n" +
  "Estrai i dati in JSON con questa struttura ESATTA:\n" +
  "{\n" +
  '  "store": string | null,        // nome del negozio/esercente\n' +
  '  "total": number | null,        // totale stampato, sempre positivo\n' +
  '  "date": string | null,         // data in formato ISO (YYYY-MM-DD)\n' +
  '  "method": "CASH"|"POS"|"CARD"|"TRANSFER" | null,\n' +
  '  "items": [\n' +
  "    {\n" +
  '      "rawName": string,         // nome esatto come appare sullo scontrino\n' +
  '      "canonicalName": string,   // nome normalizzato, minuscolo, esteso e leggibile (es. "latte parzialmente scremato")\n' +
  '      "category": string,        // UNA tra le categorie ammesse\n' +
  '      "quantity": number,        // default 1\n' +
  '      "unitPrice": number | null,\n' +
  '      "totalPrice": number | null // null se non leggibile con certezza\n' +
  "    }\n" +
  "  ]\n" +
  "}\n" +
  "Categorie ammesse (usa SOLO queste, mai inventarne altre): " +
  PRODUCT_CATEGORIES.join(", ") +
  ".\n\n" +
  "REGOLE FONDAMENTALI:\n" +
  "- Estrai OGNI riga prodotto in ordine dall'alto verso il basso, senza saltarne nessuna. " +
  "Gli scontrini italiani possono avere 50+ righe.\n" +
  "- Lo stesso prodotto può comparire su più righe: includile TUTTE separatamente, non unirle.\n" +
  "- Le righe che iniziano (o contengono come voce) 'Sconto', 'Sconto Carta', 'C.Insieme', " +
  "'STORNO', 'CORR:', 'SUBTOTALE', 'TOTALE', 'PAGAMENTO', 'RESTO', 'CONTANTE', 'CARTA', 'IVA', " +
  "'NUMERO ARTICOLI', 'PUNTI' NON sono prodotti: escludile dagli items.\n" +
  "- quantity: di default 1. Metti quantity > 1 SOLO se lo scontrino mostra esplicitamente una " +
  "moltiplicazione (es. '2 x 1,82'). NON dedurre la quantità dal prezzo.\n" +
  "- unitPrice: il prezzo unitario solo se mostrato esplicitamente (es. in '2 x 1,82' → 1,82), " +
  "altrimenti null. totalPrice: il prezzo della riga effettivamente addebitato; se non leggibile " +
  "con certezza metti null.\n" +
  "- total: il valore stampato accanto a 'TOTALE COMPLESSIVO' (o 'TOTALE') in fondo allo scontrino. " +
  "NON calcolarlo tu sommando le righe.\n" +
  "- canonicalName DEVE essere coerente per lo stesso prodotto anche se rawName cambia (stesso " +
  "prodotto → stesso canonicalName). category DEVE essere esattamente una delle categorie ammesse.\n" +
  "- Se ricevi PIÙ immagini, sono sezioni sovrapposte dello STESSO scontrino fotografato dall'alto " +
  "verso il basso: ricostruisci UN unico scontrino, NON duplicare i prodotti nella zona di " +
  "sovrapposizione, e usa il totale stampato (non sommare le sezioni).\n" +
  "- Se l'immagine è una notifica bancaria senza elenco prodotti, restituisci items: [].\n" +
  "Rispondi SOLO con il JSON, nessun testo aggiuntivo.";

// POST /api/ocr/parse — multipart/form-data, field "images" (one or many)
router.post("/parse", upload.array("images", 12), async (req, res) => {
  const files = req.files || [];
  if (files.length === 0) {
    return res.status(400).json({ error: "Nessuna immagine (campo 'images')" });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY non configurata" });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // detail: "high" è decisivo sugli scontrini densi: senza, GPT-4o fa
  // downsampling dell'immagine e legge male i numeri / salta righe. Inoltriamo
  // sempre il buffer ORIGINALE (multer memoryStorage non lo tocca).
  const imageParts = files.map((f) => ({
    type: "image_url",
    image_url: {
      url: `data:${f.mimetype};base64,${f.buffer.toString("base64")}`,
      detail: "high",
    },
  }));

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: 0, // deterministico: nessuna "creatività" sui numeri
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                files.length > 1
                  ? `Queste ${files.length} immagini sono sezioni di un unico scontrino: estrai i dati e l'elenco prodotti unendole.`
                  : "Estrai i dati e l'elenco prodotti da questo scontrino.",
            },
            ...imageParts,
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

    // Normalize items: clamp categories to the allowed list, default quantity,
    // and PRESERVE null prices (a null is a deliberate "non leggibile", never 0).
    const items = Array.isArray(parsed.items)
      ? parsed.items.map((it) => ({
          rawName: it.rawName ?? null,
          canonicalName: it.canonicalName ?? it.rawName ?? null,
          category: normalizeCategory(it.category),
          quantity: it.quantity ?? 1,
          unitPrice: typeof it.unitPrice === "number" ? it.unitPrice : null,
          totalPrice: typeof it.totalPrice === "number" ? it.totalPrice : null,
        }))
      : [];

    const total = typeof parsed.total === "number" ? parsed.total : null;

    // Reconciliation: sum the readable line prices and flag a likely
    // incomplete/inaccurate extraction so the UI can warn the user.
    const itemsSum = items.reduce(
      (sum, it) => sum + (typeof it.totalPrice === "number" ? it.totalPrice : 0),
      0
    );
    const computedItemsTotal = Math.round(itemsSum * 100) / 100;
    const nullPriceCount = items.filter((it) => it.totalPrice == null).length;

    let warning = null;
    if (total && total > 0 && Math.abs(itemsSum - total) / total > 0.1) {
      warning = "incomplete_or_inaccurate";
    } else if (nullPriceCount > 0) {
      warning = "incomplete_or_inaccurate";
    }

    res.json({
      store: parsed.store ?? null,
      total,
      date: parsed.date ?? null,
      method: parsed.method ?? null,
      items,
      // Reconciliation metadata for the confirm screen.
      computedItemsTotal,
      declaredTotal: total,
      nullPriceCount,
      warning,
      // Backward-compatible fields so the existing transaction form can pre-fill.
      amount: total,
      type: "EXPENSE",
      description: parsed.store ?? null,
    });
  } catch (err) {
    console.error("[ocr] error:", err);
    res.status(502).json({ error: "Errore durante l'analisi OCR", detail: err.message });
  }
});

export default router;
