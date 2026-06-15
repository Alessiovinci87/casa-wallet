// OCR route — parse an Italian bank notification screenshot with GPT-4o Vision
// and return structured data to pre-fill the transaction form. Protected.
import { Router } from "express";
import multer from "multer";
import OpenAI from "openai";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();
router.use(authMiddleware);

// Keep the image in memory; we forward it to OpenAI, never to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

const SYSTEM_PROMPT =
  "Analizza questa notifica o screenshot bancario italiano. Estrai SOLO questi dati in JSON:\n" +
  "{ importo: number (positivo sempre), tipo: 'INCOME'|'EXPENSE', descrizione: string, data: string ISO, metodo: 'CASH'|'POS'|'CARD'|'TRANSFER' }\n" +
  "Se non riesci a determinare un campo, usa null. Rispondi SOLO con il JSON, nessun testo aggiuntivo.";

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
            { type: "text", text: "Estrai i dati da questa notifica bancaria." },
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

    // Map Italian fields from the model to the English fields used by the form.
    res.json({
      amount: parsed.importo,
      type: parsed.tipo,
      description: parsed.descrizione,
      date: parsed.data,
      method: parsed.metodo,
    });
  } catch (err) {
    console.error("[ocr] error:", err);
    res.status(502).json({ error: "Errore durante l'analisi OCR", detail: err.message });
  }
});

export default router;
