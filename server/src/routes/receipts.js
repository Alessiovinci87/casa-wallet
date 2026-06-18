// Receipt routes — save a scanned receipt together with its product lines,
// and list receipts with their items. All protected. Broadcasts a WebSocket
// event after a save so both users stay in sync.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { broadcast } from "../lib/ws.js";
import { normalizeCategory } from "../lib/categories.js";

const router = Router();
router.use(authMiddleware);

const PAY_METHODS = new Set(["CASH", "POS", "CARD", "TRANSFER"]);

// POST /api/receipts
// Body: {
//   store, total, date, method, category?, items: [...],
//   createTransaction?: boolean,   // create the EXPENSE transaction (scales the balance once) and link it
//   transactionId?: string         // OR link to an existing transaction
// }
router.post("/", async (req, res) => {
  const { store, total, date, method, category, transactionId, createTransaction, items } =
    req.body || {};

  if (total == null) {
    return res.status(400).json({ error: "Campo obbligatorio mancante (total)" });
  }
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: "items deve essere un array" });
  }

  const receiptDate = date ? new Date(date) : new Date();
  const payMethod = PAY_METHODS.has(method) ? method : "CARD";

  // Each item inherits store/date from the receipt when not provided, and its
  // category is clamped to the allowed list so analytics stay consistent.
  const itemRows = items.map((it) => ({
    rawName: it.rawName ?? "",
    canonicalName: it.canonicalName ?? it.rawName ?? "",
    category: normalizeCategory(it.category),
    quantity: it.quantity ?? 1,
    unitPrice: it.unitPrice ?? null,
    totalPrice: it.totalPrice,
    store: it.store ?? store ?? null,
    date: it.date ? new Date(it.date) : receiptDate,
  }));

  // Path 1: create the EXPENSE transaction together with the receipt (atomic),
  // so the balance is debited exactly once and the receipt is linked to it.
  if (createTransaction) {
    const [transaction, receipt] = await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          userId: req.user.id,
          amount: total,
          type: "EXPENSE",
          category: category || "Spesa",
          method: payMethod,
          description: store ?? null,
          date: receiptDate,
        },
      });
      const receipt = await tx.receipt.create({
        data: {
          userId: req.user.id,
          store: store ?? null,
          total,
          date: receiptDate,
          transactionId: transaction.id,
          items: { create: itemRows },
        },
        include: { items: true, transaction: true },
      });
      return [transaction, receipt];
    });

    broadcast({ event: "transaction_update", payload: { action: "created", transaction } });
    broadcast({ event: "receipt_update", payload: { action: "created", receipt } });
    return res.status(201).json(receipt);
  }

  // Path 2: receipt only, optionally linked to an existing transaction.
  const receipt = await prisma.receipt.create({
    data: {
      userId: req.user.id,
      store: store ?? null,
      total,
      date: receiptDate,
      ...(transactionId ? { transactionId } : {}),
      items: { create: itemRows },
    },
    include: { items: true },
  });

  broadcast({ event: "receipt_update", payload: { action: "created", receipt } });
  res.status(201).json(receipt);
});

// GET /api/receipts?store=&from=&to=  → receipts with items, newest first.
router.get("/", async (req, res) => {
  const { store, from, to } = req.query;
  const where = {};

  if (store) where.store = store;
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
  }

  const receipts = await prisma.receipt.findMany({
    where,
    include: { items: true },
    orderBy: { date: "desc" },
  });
  res.json(receipts);
});

export default router;
