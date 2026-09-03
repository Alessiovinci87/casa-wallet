// Import estratto conto CSV (scoped famiglia).
//   POST /api/import/bank-csv/preview  multipart `file` (+ mapping JSON opz.) → intestazioni,
//        righe di esempio e, con mapping, le righe parse (dedupe + categoria proposta)
//   POST /api/import/bank-csv/commit   { rows: [...], method?, learn?: bool } → crea le transazioni
//   GET  /api/import/category-rules · POST · DELETE /:id
//   GET  /api/import/recurrence-candidates?months=12 → proposte "Crea ricorrenza"
import { Router } from "express";
import multer from "multer";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { broadcast } from "../lib/ws.js";
import {
  applyMapping, categorize, detectDelimiter, detectRecurrences, guessCategory, importHash,
  normalizeDescription, parseCsv,
} from "../lib/bankImport.js";

const router = Router();
router.use(authMiddleware);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const TX_TYPES = new Set(["INCOME", "EXPENSE"]);
const PAY_METHODS = new Set(["CASH", "POS", "CARD", "TRANSFER"]);

function decode(buffer) {
  // UTF-8 con BOM o senza; fallback latin1 se compaiono caratteri di sostituzione.
  const utf8 = buffer.toString("utf8");
  return utf8.includes("�") ? buffer.toString("latin1") : utf8;
}

function parseMapping(raw) {
  if (!raw) return null;
  try {
    const m = typeof raw === "string" ? JSON.parse(raw) : raw;
    const idx = (v) => (v === "" || v == null ? null : Number(v));
    return {
      dateCol: idx(m.dateCol),
      amountCol: idx(m.amountCol),
      debitCol: idx(m.debitCol),
      creditCol: idx(m.creditCol),
      descCol: idx(m.descCol),
      hasHeader: m.hasHeader !== false,
      invertSign: Boolean(m.invertSign),
    };
  } catch {
    return null;
  }
}

// POST /api/import/bank-csv/preview
router.post("/bank-csv/preview", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "File CSV mancante (campo `file`)" });
  const text = decode(req.file.buffer);
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, delimiter);
  if (rows.length === 0) return res.status(400).json({ error: "CSV vuoto" });

  const household = await prisma.household.findUnique({ where: { id: req.user.householdId }, select: { csvMapping: true } });
  const saved = household?.csvMapping ? parseMapping(household.csvMapping) : null;
  const mapping = parseMapping(req.body?.mapping) || saved;

  const base = {
    delimiter,
    headers: rows[0],
    sample: rows.slice(1, 6),
    totalRows: rows.length - 1,
    savedMapping: saved,
    mapping,
  };
  if (!mapping || mapping.dateCol == null || mapping.descCol == null || (mapping.amountCol == null && (mapping.debitCol == null || mapping.creditCol == null))) {
    return res.json({ ...base, parsed: null });
  }

  const parsed = applyMapping(rows, mapping);
  const valid = parsed.filter((r) => !r.error);
  const hashes = valid.map((r) => r.hash);
  const [existing, rules] = await Promise.all([
    prisma.transaction.findMany({
      where: { householdId: req.user.householdId, importHash: { in: hashes } },
      select: { importHash: true },
    }),
    prisma.categoryRule.findMany({ where: { householdId: req.user.householdId } }),
  ]);
  const dupes = new Set(existing.map((t) => t.importHash));
  // Dedupe anche dentro il file stesso.
  const seen = new Set();
  const out = parsed.map((r) => {
    if (r.error) return r;
    const duplicate = dupes.has(r.hash) || seen.has(r.hash);
    seen.add(r.hash);
    const byRule = categorize(r.description, rules, r.type);
    return {
      ...r,
      duplicate,
      category: byRule || guessCategory(r.description, r.type) || null,
      categorySource: byRule ? "rule" : guessCategory(r.description, r.type) ? "keyword" : null,
    };
  });

  if (req.body?.saveMapping === "true" || req.body?.saveMapping === true) {
    await prisma.household.update({ where: { id: req.user.householdId }, data: { csvMapping: JSON.stringify(mapping) } });
  }

  res.json({
    ...base,
    parsed: out,
    stats: {
      total: out.length,
      errors: out.filter((r) => r.error).length,
      duplicates: out.filter((r) => r.duplicate).length,
      uncategorized: out.filter((r) => !r.error && !r.duplicate && !r.category).length,
    },
  });
});

// POST /api/import/bank-csv/commit
// body: { rows: [{ date, amount, type, description, category, method?, learn? }], method? }
router.post("/bank-csv/commit", async (req, res) => {
  const { rows, method: defaultMethod = "TRANSFER" } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "rows vuoto" });
  if (!PAY_METHODS.has(defaultMethod)) return res.status(400).json({ error: "method non valido" });
  if (rows.length > 2000) return res.status(400).json({ error: "Massimo 2000 righe per import" });

  const prepared = [];
  const errors = [];
  for (const [i, r] of rows.entries()) {
    const date = r.date ? new Date(r.date) : null;
    const amount = Number(r.amount);
    if (!date || Number.isNaN(date.getTime())) { errors.push({ index: i, error: "date non valida" }); continue; }
    if (!Number.isFinite(amount) || amount <= 0) { errors.push({ index: i, error: "amount non valido" }); continue; }
    if (!TX_TYPES.has(r.type)) { errors.push({ index: i, error: "type non valido" }); continue; }
    if (!r.category || !String(r.category).trim()) { errors.push({ index: i, error: "categoria mancante" }); continue; }
    const method = r.method && PAY_METHODS.has(r.method) ? r.method : defaultMethod;
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const signed = r.type === "EXPENSE" ? -amount : amount;
    prepared.push({
      index: i,
      data: {
        userId: req.user.id,
        householdId: req.user.householdId,
        amount,
        type: r.type,
        category: String(r.category).trim(),
        method,
        description: r.description ? String(r.description).trim().slice(0, 200) : null,
        date: day,
        importHash: r.hash || importHash({ date: day, amount: signed, description: r.description }),
      },
      learn: Boolean(r.learn),
    });
  }

  const hashes = prepared.map((p) => p.data.importHash);
  const existing = await prisma.transaction.findMany({
    where: { householdId: req.user.householdId, importHash: { in: hashes } },
    select: { importHash: true },
  });
  const dupes = new Set(existing.map((t) => t.importHash));
  const seen = new Set();
  const toCreate = [];
  let skipped = 0;
  for (const p of prepared) {
    if (dupes.has(p.data.importHash) || seen.has(p.data.importHash)) { skipped++; continue; }
    seen.add(p.data.importHash);
    toCreate.push(p);
  }

  const created = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const p of toCreate) out.push(await tx.transaction.create({ data: p.data }));
    // Regole apprese: pattern = descrizione normalizzata (max 60 char).
    for (const p of toCreate.filter((x) => x.learn)) {
      const pattern = normalizeDescription(p.data.description).slice(0, 60);
      if (!pattern) continue;
      await tx.categoryRule.upsert({
        where: { householdId_pattern: { householdId: req.user.householdId, pattern } },
        create: { householdId: req.user.householdId, pattern, category: p.data.category, type: p.data.type },
        update: { category: p.data.category, type: p.data.type },
      });
    }
    return out;
  });

  if (created.length) {
    broadcast(req.user.householdId, { event: "transaction_update", payload: { action: "imported", count: created.length } });
  }
  res.status(created.length ? 201 : 200).json({ created: created.length, skipped, errors });
});

// Regole di categorizzazione
router.get("/category-rules", async (req, res) => {
  res.json(await prisma.categoryRule.findMany({ where: { householdId: req.user.householdId }, orderBy: { pattern: "asc" } }));
});
router.post("/category-rules", async (req, res) => {
  const { pattern, category, type } = req.body || {};
  const p = normalizeDescription(pattern).slice(0, 60);
  if (!p || !category) return res.status(400).json({ error: "pattern e category obbligatori" });
  if (type != null && type !== "" && !TX_TYPES.has(type)) return res.status(400).json({ error: "type non valido" });
  const rule = await prisma.categoryRule.upsert({
    where: { householdId_pattern: { householdId: req.user.householdId, pattern: p } },
    create: { householdId: req.user.householdId, pattern: p, category: String(category).trim(), type: type || null },
    update: { category: String(category).trim(), type: type || null },
  });
  res.status(201).json(rule);
});
router.delete("/category-rules/:id", async (req, res) => {
  const rule = await prisma.categoryRule.findFirst({ where: { id: req.params.id, householdId: req.user.householdId } });
  if (!rule) return res.status(404).json({ error: "Regola non trovata" });
  await prisma.categoryRule.delete({ where: { id: rule.id } });
  res.json({ ok: true, id: rule.id });
});

// GET /api/import/recurrence-candidates?months=12 — spese/entrate con stesso
// importo ±2% e stesso giorno ±3 in ≥3 mesi, non ancora coperte da una regola.
router.get("/recurrence-candidates", async (req, res) => {
  const months = Math.min(36, Math.max(3, Number(req.query.months) || 12));
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - months);
  const [txs, rules] = await Promise.all([
    prisma.transaction.findMany({
      where: { householdId: req.user.householdId, date: { gte: since }, recurringRuleId: null },
      select: { id: true, date: true, amount: true, type: true, category: true, description: true },
    }),
    prisma.recurringRule.findMany({ where: { householdId: req.user.householdId }, select: { description: true, type: true, amount: true, dayOfMonth: true } }),
  ]);
  // Già coperta: stessa descrizione normalizzata, oppure stesso tipo + importo ±2% + giorno ±3.
  const covered = (p) =>
    rules.some(
      (r) =>
        r.type === p.type &&
        (normalizeDescription(r.description) === normalizeDescription(p.description) ||
          (Math.abs(r.amount - p.amount) <= p.amount * 0.02 + 0.01 && r.dayOfMonth != null && Math.abs(r.dayOfMonth - p.dayOfMonth) <= 3))
    );
  const proposals = detectRecurrences(txs).filter((p) => !covered(p));
  res.json({ months, proposals });
});

export default router;
