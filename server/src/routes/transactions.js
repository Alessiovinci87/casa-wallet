// Transaction routes — all protected. Broadcasts a WebSocket event after
// every create/update/delete so both users stay in sync in real time.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { broadcast } from "../lib/ws.js";
import { checkUnusualSpend } from "../lib/spendAlert.js";

const router = Router();
router.use(authMiddleware);

// Allowed values (SQLite has no native enums, so we validate here).
const TX_TYPES = new Set(["INCOME", "EXPENSE"]);
const PAY_METHODS = new Set(["CASH", "POS", "CARD", "TRANSFER"]);

// A TaxSaving is created only for INCOME transactions with a positive taxPercent.
function taxApplies(type, taxPercent) {
  return type === "INCOME" && typeof taxPercent === "number" && taxPercent > 0;
}

function emit(householdId, action, transaction) {
  broadcast(householdId, { event: "transaction_update", payload: { action, transaction } });
}

// POST /api/transactions
router.post("/", async (req, res) => {
  const {
    amount, type, category, subcategory, method, description, date, taxPercent,
  } = req.body || {};

  if (amount == null || !type || !category || !method || !date) {
    return res.status(400).json({ error: "Campi obbligatori mancanti (amount, type, category, method, date)" });
  }
  if (!TX_TYPES.has(type)) {
    return res.status(400).json({ error: "type non valido (INCOME | EXPENSE)" });
  }
  if (!PAY_METHODS.has(method)) {
    return res.status(400).json({ error: "method non valido (CASH | POS | CARD | TRANSFER)" });
  }

  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: "amount deve essere un numero > 0" });
  }
  const when = new Date(date);
  if (Number.isNaN(when.getTime())) {
    return res.status(400).json({ error: "date non valida" });
  }
  const taxPct = taxPercent == null || taxPercent === "" ? null : Number(taxPercent);
  if (taxPct != null && (!Number.isFinite(taxPct) || taxPct < 0 || taxPct > 100)) {
    return res.status(400).json({ error: "taxPercent deve essere tra 0 e 100" });
  }

  const applies = taxApplies(type, taxPct);
  const taxAmount = applies ? Number((amountNum * taxPct) / 100) : null;

  const transaction = await prisma.transaction.create({
    data: {
      userId: req.user.id,
      householdId: req.user.householdId,
      amount: amountNum,
      type,
      category,
      subcategory: subcategory ?? null,
      method,
      description: description ?? null,
      date: when,
      taxPercent: applies ? taxPct : null,
      taxAmount,
      ...(applies && {
        taxSaving: {
          create: {
            amount: taxAmount,
            month: when.getUTCMonth() + 1,
            year: when.getUTCFullYear(),
          },
        },
      }),
    },
    include: { taxSaving: true, user: { select: { id: true, name: true } } },
  });

  emit(req.user.householdId, "created", transaction);

  // Fire-and-forget: push "spesa insolita" se questa transazione fa superare
  // la soglia mensile della categoria (1.5× la media storica).
  if (type === "EXPENSE") {
    checkUnusualSpend({ householdId: req.user.householdId, category, amount: amountNum, date: when });
  }

  res.status(201).json(transaction);
});

// GET /api/transactions?month=&year=&type=&category=&method=
router.get("/", async (req, res) => {
  const { month, year, type, category, method } = req.query;
  const where = { householdId: req.user.householdId };

  if (type) where.type = type;
  if (category) where.category = category;
  if (method) where.method = method;

  // Date range filter: requires at least a year. With month, narrows to that month.
  if (year) {
    const y = Number(year);
    if (month) {
      const m = Number(month) - 1; // 0-indexed
      where.date = { gte: new Date(Date.UTC(y, m, 1)), lt: new Date(Date.UTC(y, m + 1, 1)) };
    } else {
      where.date = { gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) };
    }
  }

  const transactions = await prisma.transaction.findMany({
    where,
    include: { taxSaving: true, user: { select: { id: true, name: true } } },
    orderBy: { date: "desc" },
  });
  res.json(transactions);
});

// PUT /api/transactions/:id
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  // Scoped alla famiglia: 404 se la transazione appartiene a un'altra famiglia.
  const existing = await prisma.transaction.findFirst({
    where: { id, householdId: req.user.householdId },
    include: { taxSaving: true },
  });
  if (!existing) {
    return res.status(404).json({ error: "Transazione non trovata" });
  }

  const {
    amount, type, category, subcategory, method, description, date, taxPercent,
  } = req.body || {};

  if (type && !TX_TYPES.has(type)) {
    return res.status(400).json({ error: "type non valido (INCOME | EXPENSE)" });
  }
  if (method && !PAY_METHODS.has(method)) {
    return res.status(400).json({ error: "method non valido (CASH | POS | CARD | TRANSFER)" });
  }

  const nextAmount = amount != null ? Number(amount) : existing.amount;
  if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
    return res.status(400).json({ error: "amount deve essere un numero > 0" });
  }
  const nextType = type ?? existing.type;
  const nextDate = date ? new Date(date) : existing.date;
  if (Number.isNaN(nextDate.getTime())) {
    return res.status(400).json({ error: "date non valida" });
  }
  const nextTaxPercent =
    taxPercent !== undefined
      ? taxPercent == null || taxPercent === ""
        ? null
        : Number(taxPercent)
      : existing.taxPercent;
  if (nextTaxPercent != null && (!Number.isFinite(nextTaxPercent) || nextTaxPercent < 0 || nextTaxPercent > 100)) {
    return res.status(400).json({ error: "taxPercent deve essere tra 0 e 100" });
  }

  const applies = taxApplies(nextType, nextTaxPercent);
  const taxAmount = applies ? Number((nextAmount * nextTaxPercent) / 100) : null;

  const data = {
    amount: nextAmount,
    type: nextType,
    category: category ?? existing.category,
    subcategory: subcategory !== undefined ? subcategory : existing.subcategory,
    method: method ?? existing.method,
    description: description !== undefined ? description : existing.description,
    date: nextDate,
    taxPercent: applies ? nextTaxPercent : null,
    taxAmount,
  };

  // Keep the linked TaxSaving consistent with the updated transaction.
  if (applies) {
    data.taxSaving = {
      upsert: {
        create: { amount: taxAmount, month: nextDate.getUTCMonth() + 1, year: nextDate.getUTCFullYear() },
        update: { amount: taxAmount, month: nextDate.getUTCMonth() + 1, year: nextDate.getUTCFullYear() },
      },
    };
  } else if (existing.taxSaving) {
    data.taxSaving = { delete: true };
  }

  const transaction = await prisma.transaction.update({
    where: { id },
    data,
    include: { taxSaving: true, user: { select: { id: true, name: true } } },
  });

  emit(req.user.householdId, "updated", transaction);
  res.json(transaction);
});

// DELETE /api/transactions/:id
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  // Scoped alla famiglia: 404 se la transazione appartiene a un'altra famiglia.
  const existing = await prisma.transaction.findFirst({
    where: { id, householdId: req.user.householdId },
    include: { taxSaving: true },
  });
  if (!existing) {
    return res.status(404).json({ error: "Transazione non trovata" });
  }

  // Remove the linked TaxSaving first (FK), then the transaction.
  if (existing.taxSaving) {
    await prisma.taxSaving.delete({ where: { id: existing.taxSaving.id } });
  }
  await prisma.transaction.delete({ where: { id } });

  emit(req.user.householdId, "deleted", existing);
  res.json({ ok: true, id });
});

export default router;
