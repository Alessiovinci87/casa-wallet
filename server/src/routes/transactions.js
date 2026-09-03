// Transaction routes — all protected. Broadcasts a WebSocket event after
// every create/update/delete so both users stay in sync in real time.
import { Router } from "express";
import { resolveAccountId } from "../lib/accounts.js";
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

const cleanText = (v, max) => {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

// GET /api/transactions/merchants?type=EXPENSE — "Dove" già usati dalla famiglia,
// con categoria/metodo più frequenti e le "Cosa" più recenti: alimentano i
// suggerimenti della schermata Nuova spesa. Ordinati per uso recente.
router.get("/merchants", async (req, res) => {
  const type = TX_TYPES.has(req.query.type) ? req.query.type : "EXPENSE";
  const rows = await prisma.transaction.findMany({
    where: { householdId: req.user.householdId, type, merchant: { not: null } },
    select: { merchant: true, what: true, category: true, method: true, date: true, amount: true },
    orderBy: { date: "desc" },
    take: 2000,
  });
  const byKey = new Map();
  for (const r of rows) {
    const key = r.merchant.toLowerCase();
    let m = byKey.get(key);
    if (!m) { m = { merchant: r.merchant, count: 0, lastAt: r.date, cats: {}, methods: {}, whats: new Map(), total: 0 }; byKey.set(key, m); }
    m.count += 1;
    m.total += r.amount;
    m.cats[r.category] = (m.cats[r.category] || 0) + 1;
    m.methods[r.method] = (m.methods[r.method] || 0) + 1;
    if (r.what && !m.whats.has(r.what.toLowerCase())) m.whats.set(r.what.toLowerCase(), r.what);
  }
  const mode = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const merchants = [...byKey.values()]
    .sort((a, b) => b.lastAt - a.lastAt)
    .map((m) => ({ merchant: m.merchant, count: m.count, total: Number(m.total.toFixed(2)), lastAt: m.lastAt, category: mode(m.cats), method: mode(m.methods), whats: [...m.whats.values()].slice(0, 8) }));
  const recentWhats = [];
  const seenW = new Set();
  for (const r of rows) {
    if (!r.what) continue;
    const k = r.what.toLowerCase();
    if (seenW.has(k)) continue;
    seenW.add(k);
    recentWhats.push(r.what);
    if (recentWhats.length >= 20) break;
  }
  res.json({ merchants, recentWhats });
});

// POST /api/transactions
router.post("/", async (req, res) => {
  const {
    amount, type, category, subcategory, method, description, date, taxPercent, accountId, merchant, what,
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
  let account;
  try { account = await resolveAccountId(req.user.householdId, accountId); } catch (err) { return res.status(400).json({ error: err.message }); }

  const transaction = await prisma.transaction.create({
    data: {
      userId: req.user.id,
      householdId: req.user.householdId,
      accountId: account,
      amount: amountNum,
      type,
      category,
      subcategory: subcategory ?? null,
      method,
      merchant: cleanText(merchant, 80),
      what: cleanText(what, 120),
      // Senza descrizione esplicita: "Dove · Cosa" (resta leggibile nelle liste e negli export).
      description: cleanText(description, 200) ?? [cleanText(merchant, 80), cleanText(what, 120)].filter(Boolean).join(" · ") ?? null,
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

  // Filtro per conto: il predefinito comprende anche le transazioni senza conto.
  const { accountId } = req.query;
  if (accountId) {
    const acc = await prisma.bankAccount.findFirst({ where: { id: String(accountId), householdId: req.user.householdId }, select: { id: true, isDefault: true } });
    if (!acc) return res.status(400).json({ error: "Conto non trovato" });
    if (acc.isDefault) where.OR = [{ accountId: acc.id }, { accountId: null }];
    else where.accountId = acc.id;
  }

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
    include: {
      taxSaving: true,
      user: { select: { id: true, name: true } },
      invoice: { select: { id: true, numero: true } }, // badge "fattura n. X" in Entrate
      goalContribution: { select: { id: true, goalId: true } }, // chip "da obiettivo" in Uscite
      account: { select: { id: true, name: true } },
    },
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
    amount, type, category, subcategory, method, description, date, taxPercent, accountId, merchant, what,
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
  if (accountId !== undefined) {
    try { data.accountId = await resolveAccountId(req.user.householdId, accountId); } catch (err) { return res.status(400).json({ error: err.message }); }
  }
  if (merchant !== undefined) data.merchant = cleanText(merchant, 80);
  if (what !== undefined) data.what = cleanText(what, 120);
  if (description === undefined && (merchant !== undefined || what !== undefined)) {
    const m = merchant !== undefined ? cleanText(merchant, 80) : existing.merchant;
    const w = what !== undefined ? cleanText(what, 120) : existing.what;
    const derived = [m, w].filter(Boolean).join(" · ");
    if (derived) data.description = derived;
  }

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
