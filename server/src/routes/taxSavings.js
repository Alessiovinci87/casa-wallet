// Tax savings ("salvadanaio tasse") routes — all protected.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { sendTaxAlert } from "../lib/taxAlert.js";

const router = Router();
router.use(authMiddleware);

// GET /api/tax-savings → total pending (not transferred) + full list by month/year.
router.get("/", async (_req, res) => {
  const items = await prisma.taxSaving.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }],
    include: { transaction: true },
  });

  const totalPending = items
    .filter((t) => !t.transferred)
    .reduce((sum, t) => sum + t.amount, 0);

  res.json({ totalPending, items });
});

// GET /api/tax-savings/summary → { totalPending, byMonth: [{month, year, amount, transferred}] }
router.get("/summary", async (_req, res) => {
  const items = await prisma.taxSaving.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  // Aggregate amounts per month/year. `transferred` is true only when every
  // entry in that bucket has been transferred.
  const buckets = new Map();
  for (const t of items) {
    const key = `${t.year}-${t.month}`;
    const b = buckets.get(key) || { month: t.month, year: t.year, amount: 0, transferred: true };
    b.amount += t.amount;
    b.transferred = b.transferred && t.transferred;
    buckets.set(key, b);
  }

  const totalPending = items
    .filter((t) => !t.transferred)
    .reduce((sum, t) => sum + t.amount, 0);

  res.json({ totalPending, byMonth: [...buckets.values()] });
});

// PUT /api/tax-savings/:id/transfer → mark as transferred.
router.put("/:id/transfer", async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.taxSaving.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: "Salvadanaio non trovato" });
  }

  const updated = await prisma.taxSaving.update({
    where: { id },
    data: { transferred: true, transferredAt: new Date() },
  });
  res.json(updated);
});

// POST /api/tax-savings/send-alert → invia subito l'email di promemoria tasse
// (utile per testare il contenuto senza aspettare il cron mensile).
router.post("/send-alert", async (_req, res) => {
  try {
    const result = await sendTaxAlert({ force: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Invio alert fallito" });
  }
});

export default router;
