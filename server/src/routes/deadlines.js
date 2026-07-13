// Scadenze fiscali PERSONALI — CRUD + generazione da stima + trigger promemoria di test.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { sendDeadlineRemindersForUser } from "../lib/deadlineReminder.js";
import { estimateTaxPayments } from "../lib/taxEstimate.js";

const router = Router();
router.use(authMiddleware);

const DEADLINE_TYPES = new Set(["IRPEF_SALDO", "IRPEF_ACCONTO", "IVA", "INPS", "ALTRO"]);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function enrich(deadline) {
  const today = new Date();
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const daysUntil = Math.round((new Date(deadline.dueDate).getTime() - todayUTC) / MS_PER_DAY);
  return { ...deadline, daysUntil, overdue: !deadline.paid && daysUntil < 0 };
}

// GET /api/deadlines?includePaid=false
router.get("/", async (req, res) => {
  const where = { userId: req.user.id };
  if (req.query.includePaid === "false") where.paid = false;
  const deadlines = await prisma.taxDeadline.findMany({
    where,
    orderBy: { dueDate: "asc" },
  });
  res.json(deadlines.map(enrich));
});

// POST /api/deadlines  body: { name, type, dueDate, expectedAmount }
router.post("/", async (req, res) => {
  const { name, type, dueDate, expectedAmount } = req.body || {};
  if (!name || !type || !dueDate || expectedAmount == null) {
    return res.status(400).json({ error: "Campi obbligatori: name, type, dueDate, expectedAmount" });
  }
  if (!DEADLINE_TYPES.has(type)) {
    return res.status(400).json({ error: "type non valido (IRPEF_SALDO | IRPEF_ACCONTO | IVA | INPS | ALTRO)" });
  }
  const when = new Date(dueDate);
  if (Number.isNaN(when.getTime())) {
    return res.status(400).json({ error: "dueDate non valida" });
  }
  if (Number(expectedAmount) <= 0) {
    return res.status(400).json({ error: "expectedAmount deve essere > 0" });
  }
  // Una data nel passato è ammessa (scadenza già nota ma non registrata prima).
  const deadline = await prisma.taxDeadline.create({
    data: {
      userId: req.user.id,
      name: String(name).trim(),
      type,
      dueDate: when,
      expectedAmount: Number(expectedAmount),
    },
  });
  res.status(201).json(enrich(deadline));
});

// POST /api/deadlines/generate  body: { year? } — crea le scadenze standard del
// forfettario (30/6 saldo+1° acconto, 30/11 2° acconto) con gli importi stimati
// dalle fatture. Idempotente: salta le scadenze che esistono già (stesso type e
// stesso anno di dueDate).
router.post("/generate", async (req, res) => {
  const now = new Date();
  const rawYear = Number(req.body?.year);
  const year =
    Number.isInteger(rawYear) && rawYear >= 2020 && rawYear <= now.getUTCFullYear() + 1
      ? rawYear
      : now.getUTCFullYear();

  const estimate = await estimateTaxPayments({ userId: req.user.id, year });
  if (!estimate.ok) return res.status(400).json({ error: estimate.detail || estimate.reason });
  if (estimate.noHistory) {
    return res.status(400).json({
      error: `Nessuna fattura incassata nel ${year - 1}: non c'è una base per stimare saldo e acconti.`,
    });
  }

  const candidates = [
    {
      name: `Saldo ${year - 1} + 1° acconto ${year} (stima)`,
      type: "IRPEF_SALDO",
      dueDate: estimate.payments.giugno.dueDate,
      expectedAmount: estimate.payments.giugno.amount,
    },
    {
      name: `2° acconto ${year} (stima)`,
      type: "IRPEF_ACCONTO",
      dueDate: estimate.payments.novembre.dueDate,
      expectedAmount: estimate.payments.novembre.amount,
    },
  ].filter((c) => c.expectedAmount > 0);

  const existing = await prisma.taxDeadline.findMany({
    where: {
      userId: req.user.id,
      dueDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
    },
    select: { type: true },
  });
  const existingTypes = new Set(existing.map((d) => d.type));

  const created = [];
  const skipped = [];
  for (const c of candidates) {
    if (existingTypes.has(c.type)) {
      skipped.push({ type: c.type, reason: "esiste già una scadenza di questo tipo nell'anno" });
      continue;
    }
    created.push(await prisma.taxDeadline.create({ data: { userId: req.user.id, ...c } }));
  }

  res.status(created.length ? 201 : 200).json({
    created: created.map(enrich),
    skipped,
    estimate: { giugno: estimate.payments.giugno, novembre: estimate.payments.novembre },
    disclaimer: estimate.disclaimer,
  });
});

// PUT /api/deadlines/:id — update parziale (+ paid)
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.taxDeadline.findFirst({ where: { id, userId: req.user.id } });
  if (!existing) {
    return res.status(404).json({ error: "Scadenza non trovata" });
  }

  const { name, type, dueDate, expectedAmount, paid } = req.body || {};
  if (type !== undefined && !DEADLINE_TYPES.has(type)) {
    return res.status(400).json({ error: "type non valido" });
  }
  if (expectedAmount !== undefined && Number(expectedAmount) <= 0) {
    return res.status(400).json({ error: "expectedAmount deve essere > 0" });
  }
  const when = dueDate !== undefined ? new Date(dueDate) : undefined;
  if (when !== undefined && Number.isNaN(when.getTime())) {
    return res.status(400).json({ error: "dueDate non valida" });
  }

  const data = {};
  if (name !== undefined) data.name = String(name).trim();
  if (type !== undefined) data.type = type;
  if (when !== undefined) data.dueDate = when;
  if (expectedAmount !== undefined) data.expectedAmount = Number(expectedAmount);
  if (paid !== undefined) {
    data.paid = Boolean(paid);
    data.paidAt = paid ? new Date() : null;
  }

  const deadline = await prisma.taxDeadline.update({ where: { id }, data });
  res.json(enrich(deadline));
});

// DELETE /api/deadlines/:id
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.taxDeadline.findFirst({ where: { id, userId: req.user.id } });
  if (!existing) {
    return res.status(404).json({ error: "Scadenza non trovata" });
  }
  await prisma.taxDeadline.delete({ where: { id } });
  res.json({ ok: true, id });
});

// POST /api/deadlines/send-reminders  body: { force? } — trigger di test.
router.post("/send-reminders", async (req, res) => {
  try {
    const result = await sendDeadlineRemindersForUser(req.user.id, {
      force: Boolean(req.body?.force),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Invio promemoria fallito" });
  }
});

export default router;
