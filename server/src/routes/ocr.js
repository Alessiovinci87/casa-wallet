// OCR route — parse an Italian store receipt (or bank notification) with
// GPT-4o Vision. Accepts one OR several images (sections of the same long
// receipt) under the "images" field and reconstructs a single receipt with its
// product lines, categorized for later analytics. Protected.
import { Router } from "express";
import multer from "multer";
import OpenAI from "openai";
import sharp from "sharp";
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
  "- quantity = 1 SEMPRE, di default. Imposta quantity > 1 SOLO se sullo scontrino c'è una " +
  "moltiplicazione ESPLICITA scritta (es. '3 x 1,50' oppure 'n.3'). In ogni altro caso quantity = 1. " +
  "NON dedurre MAI la quantità dal prezzo o dal contesto.\n" +
  "- unitPrice: il prezzo unitario SOLO se è presente una moltiplicazione esplicita (es. in " +
  "'3 x 1,50' → 1,50); altrimenti null. totalPrice: il prezzo della riga effettivamente addebitato; " +
  "se non leggibile con certezza metti null.\n" +
  "- total: il valore stampato accanto a 'TOTALE COMPLESSIVO' (o 'TOTALE') in fondo allo scontrino. " +
  "NON calcolarlo tu sommando le righe.\n" +
  "- canonicalName DEVE essere coerente per lo stesso prodotto anche se rawName cambia (stesso " +
  "prodotto → stesso canonicalName). category DEVE essere esattamente una delle categorie ammesse.\n" +
  "- Se ricevi PIÙ immagini, sono sezioni sovrapposte dello STESSO scontrino fotografato dall'alto " +
  "verso il basso: ricostruisci UN unico scontrino, NON duplicare i prodotti nella zona di " +
  "sovrapposizione, e usa il totale stampato (non sommare le sezioni).\n" +
  "- Se l'immagine è una notifica bancaria senza elenco prodotti, restituisci items: [].\n" +
  "Rispondi SOLO con il JSON, nessun testo aggiuntivo.";

// Second-pass prompt: re-read ONLY the prices against the same image, given the
// first-pass list and the declared total, to catch misread digits.
const VERIFY_SYSTEM_PROMPT =
  "Sei un verificatore di prezzi di scontrini italiani. Ricevi l'immagine dello scontrino e una " +
  "lista di prodotti già estratti, ciascuno con un id, il nome e il prezzo letto.\n" +
  "Compito: verifica OGNI prezzo confrontandolo con l'immagine, riga per riga. Sullo scontrino i " +
  "prezzi sono nella colonna a DESTRA di ogni riga prodotto. Correggi i prezzi sbagliati leggendo con " +
  "attenzione le cifre (occhio a coppie facilmente confuse: 3/8, 5/6, 0/6/8, 1/7, e alla virgola dei " +
  "decimali).\n" +
  "La somma dei prezzi dei prodotti (al netto degli sconti) deve AVVICINARSI al TOTALE COMPLESSIVO " +
  "dichiarato. Se la somma non torna, rileggi con più attenzione le righe dove il prezzo è dubbio.\n" +
  "Per un prezzo davvero illeggibile usa null, MAI un numero inventato.\n" +
  "NON aggiungere e NON togliere righe: restituisci esattamente gli stessi id ricevuti.\n" +
  'Rispondi SOLO con JSON in questo formato: {"items":[{"id":number,"totalPrice":number|null}]}';

// Pre-processing — migliora la leggibilità dei testi piccoli sugli scontrini
// PRIMA di inviarli a GPT-4o Vision:
//   - .rotate()      rispetta l'orientamento EXIF della foto
//   - .trim()        crop automatico dei bordi bianchi uniformi
//   - .grayscale()   scala di grigi
//   - .normalize()   aumento contrasto (stretch della gamma tonale)
//   - .sharpen()     nitidezza bordi per i testi piccoli
//   - .resize(1800)  upscaling per far leggere meglio a GPT-4o la colonna prezzi
// NB: niente binarizzazione a soglia fissa (.threshold): elimina le sfumature
// che GPT-4o usa per distinguere cifre simili (3/8, 0/6, 1/7) e rovina le
// stampe sbiadite o chiare.
// Restituisce { buffer, mimetype }. In caso di errore si torna all'immagine
// originale, così l'OCR non si rompe mai per colpa del pre-processing.
async function preprocessImage(file) {
  const kb = (n) => Math.round(n / 1024);
  try {
    const t0 = Date.now();
    const meta = await sharp(file.buffer).metadata();
    const { data, info } = await sharp(file.buffer)
      .rotate()
      .trim({ threshold: 25 })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.2, m1: 0.5, m2: 3 })
      .resize({ width: 1800, withoutEnlargement: false, kernel: "lanczos3" })
      .png()
      .toBuffer({ resolveWithObject: true });
    const ms = Date.now() - t0;
    console.log(
      `[ocr] preprocess: ${meta.width ?? "?"}x${meta.height ?? "?"} ${kb(file.buffer.length)}KB ` +
        `-> ${info.width}x${info.height} ${kb(info.size)}KB in ${ms}ms`
    );
    return { buffer: data, mimetype: "image/png" };
  } catch (err) {
    console.error("[ocr] preprocess fallito, uso immagine originale:", err.message);
    return { buffer: file.buffer, mimetype: file.mimetype };
  }
}

// PASS 1 — extract the full receipt (store, total, date, method, items).
async function extractReceipt(openai, imageParts, multiImage) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: multiImage
              ? "Queste immagini sono sezioni di un unico scontrino: estrai i dati e l'elenco prodotti unendole."
              : "Estrai i dati e l'elenco prodotti da questo scontrino.",
          },
          ...imageParts,
        ],
      },
    ],
  });
  return JSON.parse(completion.choices[0]?.message?.content || "{}");
}

// PASS 2 — re-verify the line prices against the same image. Returns a Map
// id → corrected totalPrice (number | null). On any failure returns null so the
// caller keeps the first-pass prices.
async function verifyPrices(openai, imageParts, items, declaredTotal) {
  const list = items.map((it, id) => ({ id, name: it.rawName ?? it.canonicalName ?? "", totalPrice: it.totalPrice }));
  const totalText = typeof declaredTotal === "number" ? `${declaredTotal.toFixed(2)}€` : "non disponibile";

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [
        { role: "system", content: VERIFY_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `TOTALE COMPLESSIVO dichiarato: ${totalText}.\n` +
                `Lista prodotti estratti (id, nome, prezzo letto):\n` +
                JSON.stringify(list) +
                `\nVerifica e correggi i prezzi confrontandoli con l'immagine.`,
            },
            ...imageParts,
          ],
        },
      ],
    });

    const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
    if (!Array.isArray(parsed.items)) return null;

    const corrections = new Map();
    for (const c of parsed.items) {
      if (typeof c?.id === "number") {
        corrections.set(c.id, typeof c.totalPrice === "number" ? c.totalPrice : null);
      }
    }
    return corrections;
  } catch (err) {
    console.error("[ocr] verify pass failed, keeping pass-1 prices:", err.message);
    return null;
  }
}

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
  // Pre-processing lato server (sharp): contrasto + binarizzazione + crop bordi
  // bianchi, per rendere più leggibili i testi piccoli prima di GPT-4o.
  const processed = await Promise.all(files.map(preprocessImage));
  // detail: "high" è decisivo sugli scontrini densi: senza, GPT-4o fa
  // downsampling dell'immagine e legge male i numeri / salta righe.
  const imageParts = processed.map((f) => ({
    type: "image_url",
    image_url: {
      url: `data:${f.mimetype};base64,${f.buffer.toString("base64")}`,
      detail: "high",
    },
  }));

  try {
    // PASS 1 — extraction.
    let parsed;
    try {
      parsed = await extractReceipt(openai, imageParts, files.length > 1);
    } catch {
      return res.status(502).json({ error: "Risposta OCR non in formato JSON" });
    }

    // Normalize items: clamp categories, PRESERVE null prices (never 0), and
    // FIX 1 — force quantity to 1 unless there is an explicit multiplication
    // (which is the only case the model returns a unitPrice). This kills
    // invented quantities like acqua "4" / latte "4".
    let items = Array.isArray(parsed.items)
      ? parsed.items.map((it) => {
          const hasExplicitMultiplier =
            typeof it.unitPrice === "number" && Number(it.quantity) > 1;
          return {
            rawName: it.rawName ?? null,
            canonicalName: it.canonicalName ?? it.rawName ?? null,
            category: normalizeCategory(it.category),
            quantity: hasExplicitMultiplier ? Number(it.quantity) : 1,
            unitPrice: hasExplicitMultiplier ? it.unitPrice : null,
            totalPrice: typeof it.totalPrice === "number" ? it.totalPrice : null,
          };
        })
      : [];

    const total = typeof parsed.total === "number" ? parsed.total : null;

    // Reconciliation snapshot over the current items vs the declared total.
    const reconcile = () => {
      const sum = items.reduce(
        (s, it) => s + (typeof it.totalPrice === "number" ? it.totalPrice : 0),
        0
      );
      const nullCount = items.filter((it) => it.totalPrice == null).length;
      const ratio = total && total > 0 ? Math.abs(sum - total) / total : null;
      return { sum, nullCount, ratio };
    };

    // PASS 2 — re-verify prices, but ONLY when the first pass doesn't already
    // reconcile within 5% and has no null prices. Cost optimization: skips one
    // Vision call when pass 1 is already trustworthy.
    const pass1 = reconcile();
    const needsVerify =
      items.length > 0 &&
      (pass1.ratio === null || pass1.ratio > 0.05 || pass1.nullCount > 0);

    if (needsVerify) {
      const corrections = await verifyPrices(openai, imageParts, items, total);
      if (corrections) {
        items = items.map((it, id) =>
          corrections.has(id) ? { ...it, totalPrice: corrections.get(id) } : it
        );
      }
      const ratioStr = pass1.ratio === null ? "n/d" : `${(pass1.ratio * 100).toFixed(1)}%`;
      console.log(`[ocr] PASS 2 eseguito (pass1 scarto ${ratioStr}, null ${pass1.nullCount})`);
    } else {
      const ratioStr = pass1.ratio === null ? "n/d" : `${(pass1.ratio * 100).toFixed(1)}%`;
      console.log(`[ocr] PASS 2 saltato — pass1 riconcilia entro il 5% (scarto ${ratioStr})`);
    }

    // PASS 3 — final reconciliation + confidence scoring.
    const { sum: itemsSum, nullCount: nullPriceCount, ratio: finalRatio } = reconcile();
    const computedItemsTotal = Math.round(itemsSum * 100) / 100;

    let confidence = "low";
    if (finalRatio !== null) {
      if (finalRatio <= 0.05) confidence = "high";
      else if (finalRatio <= 0.15) confidence = "medium";
      else confidence = "low";
    }
    // Null prices erode confidence regardless of the sum.
    if (nullPriceCount > 0 && confidence === "high") confidence = "medium";
    if (nullPriceCount >= 3) confidence = "low";

    const warning = confidence === "low" ? "incomplete_or_inaccurate" : null;

    // Riepilogo diagnostico della scansione (per benchmark dai log di Railway).
    console.log(
      `[ocr] scan: ${files.length} img | prodotti ${items.length} | confidence ${confidence} | ` +
        `computedItemsTotal ${computedItemsTotal} vs declaredTotal ${total ?? "n/d"} | nullPrice ${nullPriceCount}`
    );

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
      confidence,
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
