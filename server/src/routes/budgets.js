// Monthly per-category budgets — protected. CRUD on CategoryBudget plus the
// current-month spending computed from EXPENSE transactions (shared household
// total, like the dashboard) so the UI can show progress and an over-80% alert.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();
router.use(authMiddleware);

// Sum of household EXPENSE for each category in the current calendar month.
async function spentByCategoryThisMonth() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const expenses = await prisma.transaction.findMany({
    where: {
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
    where: { userId: req.user.id },
    orderBy: { category: "asc" },
  });
  const spent = await spentByCategoryThisMonth();

  const items = budgets.map((b) => {
    const used = spent.get(b.category) || 0;
    const percent = b.amount > 0 ? Math.round((used / b.amount) * 100) : 0;
    return { ...b, spent: used, percent, over: used > b.amount };
  });
  res.json(items);
});

// POST /api/budgets → upsert budget for { category, amount } (unique per user+category).
router.post("/", async (req, res) => {
  const { category, amount } = req.body || {};
  if (!category || amount == null || Number(amount) <= 0) {
    return res.status(400).json({ error: "category e amount (>0) obbligatori" });
  }

  const budget = await prisma.categoryBudget.upsert({
    where: { userId_category: { userId: req.user.id, category } },
    create: { userId: req.user.id, category, amount: Number(amount) },
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
  if (!existing || existing.userId !== req.user.id) {
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
  if (!existing || existing.userId !== req.user.id) {
    return res.status(404).json({ error: "Budget non trovato" });
  }
  await prisma.categoryBudget.delete({ where: { id } });
  res.json({ ok: true, id });
});

export default router;
