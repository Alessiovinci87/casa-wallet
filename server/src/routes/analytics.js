// Analytics routes over receipt items — spending by category/store, single
// product price history, and the products you spend the most on. All protected.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

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

// GET /api/analytics/spending?from=&to=&accountId=&type=EXPENSE
// "Dove vanno i soldi": sulle TRANSAZIONI (manuali, import, scontrini, ricorrenze).
// → { total, count, byCategory[], byMerchant[{merchant,total,count,category}], byWhat[], withoutMerchant {total,count} }
router.get("/spending", async (req, res) => {
  const type = req.query.type === "INCOME" ? "INCOME" : "EXPENSE";
  const where = { householdId: req.user.householdId, type };
  const range = dateRange(req.query.from, req.query.to);
  if (range) where.date = range;
  if (req.query.accountId) {
    const acc = await prisma.bankAccount.findFirst({ where: { id: String(req.query.accountId), householdId: req.user.householdId }, select: { id: true, isDefault: true } });
    if (!acc) return res.status(400).json({ error: "Conto non trovato" });
    if (acc.isDefault) where.OR = [{ accountId: acc.id }, { accountId: null }];
    else where.accountId = acc.id;
  }
  const rows = await prisma.transaction.findMany({ where, select: { amount: true, category: true, merchant: true, what: true, description: true, date: true, recurringRuleId: true } });
  const agg = (keyFn) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      if (!k) continue;
      const kk = String(k).toLowerCase();
      const e = m.get(kk) || { key: k, total: 0, count: 0, cats: {} };
      e.total += r.amount; e.count += 1; e.cats[r.category] = (e.cats[r.category] || 0) + 1;
      m.set(kk, e);
    }
    return [...m.values()].sort((a, b) => b.total - a.total).map((e) => ({ ...e, total: Number(e.total.toFixed(2)), category: Object.entries(e.cats).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null, cats: undefined }));
  };
  const total = Number(rows.reduce((s, r) => s + r.amount, 0).toFixed(2));
  const byCategory = agg((r) => r.category).map((e) => ({ category: e.key, total: e.total, count: e.count }));
  const byMerchant = agg((r) => r.merchant).map((e) => ({ merchant: e.key, total: e.total, count: e.count, category: e.category }));
  const byWhat = agg((r) => r.what).map((e) => ({ what: e.key, total: e.total, count: e.count, category: e.category }));
  const noMerchant = rows.filter((r) => !r.merchant);
  const fixed = rows.filter((r) => r.recurringRuleId).reduce((s, r) => s + r.amount, 0);
  res.json({
    type, total, count: rows.length,
    fixed: Number(fixed.toFixed(2)), variable: Number((total - fixed).toFixed(2)),
    byCategory, byMerchant, byWhat,
    withoutMerchant: { total: Number(noMerchant.reduce((s, r) => s + r.amount, 0).toFixed(2)), count: noMerchant.length },
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
