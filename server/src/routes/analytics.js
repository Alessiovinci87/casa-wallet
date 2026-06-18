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

// GET /api/analytics/by-category?from=&to=  → [{ category, total, count }]
router.get("/by-category", async (req, res) => {
  const range = dateRange(req.query.from, req.query.to);
  const grouped = await prisma.receiptItem.groupBy({
    by: ["category"],
    where: range ? { date: range } : undefined,
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
    where: { canonicalName, ...(range ? { date: range } : {}) },
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
    where: range ? { date: range } : undefined,
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
    where: range ? { date: range } : undefined,
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

export default router;
