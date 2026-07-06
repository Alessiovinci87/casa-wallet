// Monthly per-category budgets — protected. Un budget per famiglia+categoria;
// la spesa del mese corrente è il totale EXPENSE della famiglia, così la UI
// mostra il progresso e l'alert oltre l'80%.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();
router.use(authMiddleware);

// Sum of household EXPENSE for each category in the current calendar month.
async function spentByCategoryThisMonth(householdId) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const expenses = await prisma.transaction.findMany({
    where: {
      householdId,
      type: "EXPENSE",
      date: { gte: new Date(Date.UTC(y, m, 1)), lt: new Date(Date.UTC(y, m + 1, 1)) },
    },
    select: { category: true, amount: true },
  });

  const spent = new Map();
  for (const t of expenses) {
    spent.set(t.category, (spent.get(t.category) || 0) + t.amount);
  }
  return spent;
}

// GET /api/budgets → [{ id, category, amount, spent, percent, over }]
router.get("/", async (req, res) => {
  const budgets = await prisma.categoryBudget.findMany({
    where: { householdId: req.user.householdId },
    orderBy: { category: "asc" },
  });
  const spent = await spentByCategoryThisMonth(req.user.householdId);

  const items = budgets.map((b) => {
    const used = spent.get(b.category) || 0;
    const percent = b.amount > 0 ? Math.round((used / b.amount) * 100) : 0;
    return { ...b, spent: used, percent, over: used > b.amount };
  });
  res.json(items);
});

// POST /api/budgets → upsert budget for { category, amount } (unique per famiglia+categoria).
router.post("/", async (req, res) => {
  const { category, amount } = req.body || {};
  if (!category || amount == null || Number(amount) <= 0) {
    return res.status(400).json({ error: "category e amount (>0) obbligatori" });
  }

  const budget = await prisma.categoryBudget.upsert({
    where: { householdId_category: { householdId: req.user.householdId, category } },
    create: { householdId: req.user.householdId, category, amount: Number(amount) },
    update: { amount: Number(amount) },
  });
  res.status(201).json(budget);
});

// PUT /api/budgets/:id → update the amount.
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { amount } = req.body || {};
  if (amount == null || Number(amount) <= 0) {
    return res.status(400).json({ error: "amount (>0) obbligatorio" });
  }

  const existing = await prisma.categoryBudget.findUnique({ where: { id } });
  if (!existing || existing.householdId !== req.user.householdId) {
    return res.status(404).json({ error: "Budget non trovato" });
  }

  const budget = await prisma.categoryBudget.update({
    where: { id },
    data: { amount: Number(amount) },
  });
  res.json(budget);
});

// DELETE /api/budgets/:id
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.categoryBudget.findUnique({ where: { id } });
  if (!existing || existing.householdId !== req.user.householdId) {
    return res.status(404).json({ error: "Budget non trovato" });
  }
  await prisma.categoryBudget.delete({ where: { id } });
  res.json({ ok: true, id });
});

export default router;
