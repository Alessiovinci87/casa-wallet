// Scadenze fiscali PERSONALI — CRUD + trigger promemoria di test.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { sendDeadlineRemindersForUser } from "../lib/deadlineReminder.js";

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
