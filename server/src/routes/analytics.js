// Analytics routes over receipt items — spending by category/store, single
// product price history, and the products you spend the most on. All protected.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { occurrencesBetween, todayRomeUTC } from "../lib/recurrence.js";

const router = Router();
router.use(authMiddleware);

// Build a Prisma date filter from ?from=&to= query params (on a `date` field).
function dateRange(from, to) {
  if (!from && !to) return undefined;
  const range = {};
  if (from) range.gte = new Date(from);
  if (to) range.lte = new Date(to);
  return range;
}

// GET /api/analytics/spending?from=&to=&accountId=
// "Dove vanno i soldi": sulle TRANSAZIONI (manuali, import, scontrini, ricorrenze
// già scattate) + le ricorrenze del periodo NON ancora scattate ("in arrivo"),
// così il mese è completo anche il giorno 3. Entrate e uscite insieme.
// → { expense{actual,planned,total,count}, income{...}, net, byCategory[], byMerchant[], byWhat[],
//     planned[{date, description, amount, type}], withoutMerchant{total,count} }
router.get("/spending", async (req, res) => {
  const hh = req.user.householdId;
  const where = { householdId: hh };
  const range = dateRange(req.query.from, req.query.to);
  if (range) where.date = range;
  let acc = null;
  if (req.query.accountId) {
    acc = await prisma.bankAccount.findFirst({ where: { id: String(req.query.accountId), householdId: hh }, select: { id: true, isDefault: true } });
    if (!acc) return res.status(400).json({ error: "Conto non trovato" });
    if (acc.isDefault) where.OR = [{ accountId: acc.id }, { accountId: null }];
    else where.accountId = acc.id;
  }
  const rows = await prisma.transaction.findMany({ where, select: { amount: true, type: true, category: true, merchant: true, what: true, date: true, recurringRuleId: true } });

  // Ricorrenze non ancora registrate nel periodo (da domani in poi).
  const today = todayRomeUTC();
  const from = new Date(Math.max(today.getTime() + 24 * 60 * 60 * 1000, range?.gte ? new Date(range.gte).getTime() : 0));
  const to = range?.lte ? new Date(range.lte) : null;
  const planned = [];
  if (to && from <= to) {
    const rules = await prisma.recurringRule.findMany({ where: { householdId: hh, active: true } });
    for (const r of rules) {
      const mine = !acc || r.accountId === acc.id || (acc.isDefault && !r.accountId);
      if (!mine) continue;
      const start = r.nextRunAt && r.nextRunAt > from ? r.nextRunAt : from;
      if (start > to) continue;
      for (const date of occurrencesBetween(r, start, to)) {
        planned.push({ date, type: r.type, amount: r.amount, category: r.category, description: r.description || r.category, merchant: r.description || r.category, what: null, recurringRuleId: r.id, planned: true });
      }
    }
  }
  const all = [...rows.map((r) => ({ ...r, planned: false })), ...planned];
  const sum = (list) => Number(list.reduce((s, r) => s + r.amount, 0).toFixed(2));
  const side = (type) => {
    const list = all.filter((r) => r.type === type);
    const act = list.filter((r) => !r.planned);
    const pl = list.filter((r) => r.planned);
    return { actual: sum(act), planned: sum(pl), total: sum(list), count: list.length, fixed: sum(list.filter((r) => r.recurringRuleId)), variable: sum(list.filter((r) => !r.recurringRuleId)) };
  };
  const expense = side("EXPENSE");
  const income = side("INCOME");
  const exp = all.filter((r) => r.type === "EXPENSE");
  const agg = (keyFn) => {
    const m = new Map();
    for (const r of exp) {
      const k = keyFn(r);
      if (!k) continue;
      const kk = String(k).toLowerCase();
      const e = m.get(kk) || { key: k, total: 0, planned: 0, count: 0, cats: {} };
      e.total += r.amount; e.count += 1; if (r.planned) e.planned += r.amount; e.cats[r.category] = (e.cats[r.category] || 0) + 1;
      m.set(kk, e);
    }
    return [...m.values()].sort((a, b) => b.total - a.total).map((e) => ({ key: e.key, total: Number(e.total.toFixed(2)), planned: Number(e.planned.toFixed(2)), count: e.count, category: Object.entries(e.cats).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null }));
  };
  const byCategory = agg((r) => r.category).map((e) => ({ category: e.key, total: e.total, planned: e.planned, count: e.count }));
  const byMerchant = agg((r) => r.merchant).map((e) => ({ merchant: e.key, total: e.total, planned: e.planned, count: e.count, category: e.category }));
  const byWhat = agg((r) => r.what).map((e) => ({ what: e.key, total: e.total, planned: e.planned, count: e.count, category: e.category }));
  const noMerchant = exp.filter((r) => !r.merchant && !r.planned);
  res.json({
    expense, income, net: Number((income.total - expense.total).toFixed(2)),
    // compatibilità con la prima versione
    total: expense.total, count: expense.count, fixed: expense.fixed, variable: expense.variable,
    byCategory, byMerchant, byWhat,
    planned: planned.sort((a, b) => a.date - b.date).map((p) => ({ date: p.date, type: p.type, amount: p.amount, description: p.description, category: p.category })),
    withoutMerchant: { total: sum(noMerchant), count: noMerchant.length },
  });
});

// GET /api/analytics/by-category?from=&to=  → [{ category, total, count }]
router.get("/by-category", async (req, res) => {
  const range = dateRange(req.query.from, req.query.to);
  const grouped = await prisma.receiptItem.groupBy({
    by: ["category"],
    where: {
      receipt: { householdId: req.user.householdId },
      ...(range ? { date: range } : {}),
    },
    _sum: { totalPrice: true },
    _count: { _all: true },
  });

  const result = grouped
    .map((g) => ({
      category: g.category,
      total: g._sum.totalPrice ?? 0,
      count: g._count._all,
    }))
    .sort((a, b) => b.total - a.total);

  res.json(result);
});

// GET /api/analytics/product-trend?canonicalName=...&from=&to=
//   → [{ date, store, unitPrice, totalPrice }] ordered by date (price over time).
router.get("/product-trend", async (req, res) => {
  const { canonicalName } = req.query;
  if (!canonicalName) {
    return res.status(400).json({ error: "Parametro 'canonicalName' obbligatorio" });
  }
  const range = dateRange(req.query.from, req.query.to);

  const rows = await prisma.receiptItem.findMany({
    where: {
      canonicalName,
      receipt: { householdId: req.user.householdId },
      ...(range ? { date: range } : {}),
    },
    select: { date: true, store: true, unitPrice: true, totalPrice: true },
    orderBy: { date: "asc" },
  });
  res.json(rows);
});

// GET /api/analytics/by-store?from=&to=  → [{ store, total, receiptCount }]
router.get("/by-store", async (req, res) => {
  const range = dateRange(req.query.from, req.query.to);
  const grouped = await prisma.receipt.groupBy({
    by: ["store"],
    where: {
      householdId: req.user.householdId,
      ...(range ? { date: range } : {}),
    },
    _sum: { total: true },
    _count: { _all: true },
  });

  const result = grouped
    .map((g) => ({
      store: g.store,
      total: g._sum.total ?? 0,
      receiptCount: g._count._all,
    }))
    .sort((a, b) => b.total - a.total);

  res.json(result);
});

// GET /api/analytics/top-products?limit=20&from=&to=
//   → [{ canonicalName, category, totalSpent, timesBought, avgPrice }]
router.get("/top-products", async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 20, 200));
  const range = dateRange(req.query.from, req.query.to);

  const grouped = await prisma.receiptItem.groupBy({
    by: ["canonicalName", "category"],
    where: {
      receipt: { householdId: req.user.householdId },
      ...(range ? { date: range } : {}),
    },
    _sum: { totalPrice: true },
    _count: { _all: true },
    _avg: { unitPrice: true },
  });

  const result = grouped
    .map((g) => ({
      canonicalName: g.canonicalName,
      category: g.category,
      totalSpent: g._sum.totalPrice ?? 0,
      timesBought: g._count._all,
      avgPrice: g._avg.unitPrice ?? null,
    }))
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, limit);

  res.json(result);
});

// GET /api/analytics/store-comparison?from=&to=
//   → [{ category, stores: [{ store, avgUnitPrice, count }], cheapest }]
//   Solo categorie comprate in ≥2 store (dove un confronto ha senso). Ordina i
//   negozi dal prezzo unitario medio più basso → indica quale conviene.
router.get("/store-comparison", async (req, res) => {
  const range = dateRange(req.query.from, req.query.to);
  const grouped = await prisma.receiptItem.groupBy({
    by: ["category", "store"],
    where: {
      receipt: { householdId: req.user.householdId },
      ...(range ? { date: range } : {}),
      unitPrice: { not: null },
      store: { not: null },
    },
    _avg: { unitPrice: true },
    _count: { _all: true },
  });

  const byCat = new Map();
  for (const g of grouped) {
    if (g._avg.unitPrice == null) continue;
    const list = byCat.get(g.category) || [];
    list.push({ store: g.store, avgUnitPrice: g._avg.unitPrice, count: g._count._all });
    byCat.set(g.category, list);
  }

  const result = [...byCat.entries()]
    .map(([category, stores]) => {
      stores.sort((a, b) => a.avgUnitPrice - b.avgUnitPrice);
      return { category, stores, cheapest: stores[0]?.store ?? null };
    })
    .filter((c) => c.stores.length >= 2)
    .sort((a, b) => a.category.localeCompare(b.category));

  res.json(result);
});

export default router;
