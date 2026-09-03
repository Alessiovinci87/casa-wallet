// Obiettivi di risparmio — condivisi in famiglia (personal=true → solo il
// proprietario). CRUD + versamenti/prelievi + "Distribuisci" (proposta e conferma).
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { broadcast } from "../lib/ws.js";
import { GOAL_KINDS, findGoal, listGoals, proposeAllocation, summarizeGoals } from "../lib/goals.js";

const router = Router();
router.use(authMiddleware);

const PAY_METHODS = new Set(["CASH", "POS", "CARD", "TRANSFER"]);

function emit(householdId, action, payload) {
  broadcast(householdId, { event: "goal_update", payload: { action, ...payload } });
}

function parseDate(v) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return NaN;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Valida il body (parziale per PUT). */
async function parseBody(body, req, { partial = false } = {}) {
  const b = body || {};
  const data = {};
  if (!partial && (!b.name || b.targetAmount == null) && !b.linkedRecurringRuleId) {
    return { error: "Campi obbligatori: name, targetAmount (o linkedRecurringRuleId)" };
  }
  if (b.name !== undefined) {
    if (!String(b.name).trim()) return { error: "name obbligatorio" };
    data.name = String(b.name).trim();
  }
  if (b.icon !== undefined) data.icon = b.icon ? String(b.icon).slice(0, 8) : null;
  if (b.kind !== undefined) {
    if (!GOAL_KINDS.has(b.kind)) return { error: "kind non valido (GOAL | SINKING | BUFFER)" };
    data.kind = b.kind;
  }
  if (b.targetAmount !== undefined) {
    const n = Number(b.targetAmount);
    if (!Number.isFinite(n) || n <= 0) return { error: "targetAmount deve essere > 0" };
    data.targetAmount = n;
  }
  for (const k of ["targetDate", "startDate"]) {
    const d = parseDate(b[k]);
    if (Number.isNaN(d)) return { error: `${k} non valida` };
    if (d !== undefined && !(k === "startDate" && d === null)) data[k] = d;
  }
  if (b.priority !== undefined) {
    const n = Number(b.priority);
    if (![1, 2, 3].includes(n)) return { error: "priority deve essere 1, 2 o 3" };
    data.priority = n;
  }
  if (b.active !== undefined) data.active = Boolean(b.active);
  if (b.personal !== undefined) data.personal = Boolean(b.personal);
  if (b.linkedRecurringRuleId !== undefined) {
    if (!b.linkedRecurringRuleId) data.linkedRecurringRuleId = null;
    else {
      const rule = await prisma.recurringRule.findFirst({
        where: { id: b.linkedRecurringRuleId, householdId: req.user.householdId },
      });
      if (!rule) return { error: "Ricorrenza collegata non trovata" };
      if (rule.frequency === "WEEKLY") return { error: "Collega solo ricorrenze mensili o più rare" };
      data.linkedRecurringRuleId = rule.id;
      if (data.kind === undefined && !partial) data.kind = "SINKING";
      if (data.targetAmount === undefined && !partial) data.targetAmount = rule.amount;
      if (data.name === undefined && !partial) data.name = rule.description || rule.category;
    }
  }
  if (!partial && (data.kind || "GOAL") === "GOAL" && !data.targetDate) {
    return { error: "Un obiettivo (GOAL) richiede una targetDate" };
  }
  return { data };
}

// GET /api/goals?includeInactive=true → { goals, summary }
router.get("/", async (req, res) => {
  const goals = await listGoals({
    householdId: req.user.householdId,
    userId: req.user.id,
    includeInactive: req.query.includeInactive === "true",
  });
  res.json({ goals, summary: summarizeGoals(goals) });
});

// GET /api/goals/:id/contributions — storico movimenti
router.get("/:id/contributions", async (req, res) => {
  const goal = await findGoal({ id: req.params.id, householdId: req.user.householdId, userId: req.user.id });
  if (!goal) return res.status(404).json({ error: "Obiettivo non trovato" });
  const items = await prisma.goalContribution.findMany({
    where: { goalId: goal.id },
    orderBy: { date: "desc" },
    include: { transaction: { select: { id: true, amount: true, category: true } } },
  });
  res.json(items);
});

// POST /api/goals
router.post("/", async (req, res) => {
  const parsed = await parseBody(req.body, req);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const created = await prisma.savingsGoal.create({
    data: { ...parsed.data, householdId: req.user.householdId, userId: req.user.id },
  });
  const goal = await findGoal({ id: created.id, householdId: req.user.householdId, userId: req.user.id });
  emit(req.user.householdId, "created", { goal });
  res.status(201).json(goal);
});

// PUT /api/goals/:id
router.put("/:id", async (req, res) => {
  const existing = await findGoal({ id: req.params.id, householdId: req.user.householdId, userId: req.user.id });
  if (!existing) return res.status(404).json({ error: "Obiettivo non trovato" });
  const parsed = await parseBody(req.body, req, { partial: true });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  await prisma.savingsGoal.update({ where: { id: existing.id }, data: parsed.data });
  const goal = await findGoal({ id: existing.id, householdId: req.user.householdId, userId: req.user.id });
  emit(req.user.householdId, "updated", { goal });
  res.json(goal);
});

// DELETE /api/goals/:id — contributi in cascade; le uscite reali collegate restano.
router.delete("/:id", async (req, res) => {
  const existing = await findGoal({ id: req.params.id, householdId: req.user.householdId, userId: req.user.id });
  if (!existing) return res.status(404).json({ error: "Obiettivo non trovato" });
  await prisma.savingsGoal.delete({ where: { id: existing.id } });
  emit(req.user.householdId, "deleted", { goal: { id: existing.id } });
  res.json({ ok: true, id: existing.id });
});

// POST /api/goals/:id/contribute { amount, date?, note?, createTransaction?, method?, category? }
// amount > 0 versa, < 0 preleva. Un prelievo con createTransaction=true genera
// anche l'uscita reale collegata.
router.post("/:id/contribute", async (req, res) => {
  const goal = await findGoal({ id: req.params.id, householdId: req.user.householdId, userId: req.user.id });
  if (!goal) return res.status(404).json({ error: "Obiettivo non trovato" });
  const { amount, note, createTransaction, method, category } = req.body || {};
  const n = Number(amount);
  if (!Number.isFinite(n) || n === 0) return res.status(400).json({ error: "amount deve essere un numero ≠ 0" });
  const date = parseDate(req.body?.date) ?? new Date();
  if (Number.isNaN(date)) return res.status(400).json({ error: "date non valida" });
  if (n < 0 && goal.saved + n < -0.005) {
    return res.status(400).json({ error: `Puoi prelevare al massimo ${goal.saved.toFixed(2)} €` });
  }
  const payMethod = method ?? "TRANSFER";
  if (createTransaction && !PAY_METHODS.has(payMethod)) {
    return res.status(400).json({ error: "method non valido" });
  }

  const contribution = await prisma.$transaction(async (tx) => {
    let transactionId = null;
    if (n < 0 && createTransaction) {
      const t = await tx.transaction.create({
        data: {
          userId: req.user.id,
          householdId: req.user.householdId,
          amount: Math.abs(n),
          type: "EXPENSE",
          category: category || "Altro",
          method: payMethod,
          description: `Prelievo ${goal.name}`,
          date,
        },
        include: { user: { select: { id: true, name: true } } },
      });
      transactionId = t.id;
      broadcast(req.user.householdId, { event: "transaction_update", payload: { action: "created", transaction: t } });
    }
    return tx.goalContribution.create({
      data: { goalId: goal.id, userId: req.user.id, amount: n, date, note: note || null, transactionId },
    });
  });

  const updated = await findGoal({ id: goal.id, householdId: req.user.householdId, userId: req.user.id });
  emit(req.user.householdId, "contributed", { goal: updated });
  res.status(201).json({ goal: updated, contribution });
});

/** Importo netto da distribuire: dal body o dall'entrata (amount − tasse accantonate). */
async function resolveAmount(req) {
  const { amount, incomeTransactionId } = req.body || {};
  if (incomeTransactionId) {
    const t = await prisma.transaction.findFirst({
      where: { id: incomeTransactionId, householdId: req.user.householdId, type: "INCOME" },
    });
    if (!t) return { error: "Entrata non trovata" };
    if (amount == null) return { amount: Number((t.amount - (t.taxAmount || 0)).toFixed(2)), transaction: t };
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return { error: "amount deve essere > 0" };
    return { amount: n, transaction: t };
  }
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return { error: "amount deve essere > 0" };
  return { amount: n };
}

// POST /api/goals/allocate { amount?, incomeTransactionId? } → proposta (nessuna scrittura)
router.post("/allocate", async (req, res) => {
  const r = await resolveAmount(req);
  if (r.error) return res.status(400).json({ error: r.error });
  const goals = await listGoals({ householdId: req.user.householdId, userId: req.user.id });
  const proposal = proposeAllocation(goals, r.amount);
  res.json({ ...proposal, source: r.transaction ? { transactionId: r.transaction.id, gross: r.transaction.amount, tax: r.transaction.taxAmount || 0 } : null });
});

// POST /api/goals/allocate/confirm { allocations: [{goalId, amount}], date?, note? }
// → crea i GoalContribution in un colpo solo (atomico).
router.post("/allocate/confirm", async (req, res) => {
  const { allocations, note } = req.body || {};
  if (!Array.isArray(allocations) || allocations.length === 0) {
    return res.status(400).json({ error: "allocations vuoto" });
  }
  const date = parseDate(req.body?.date) ?? new Date();
  if (Number.isNaN(date)) return res.status(400).json({ error: "date non valida" });
  const goals = await listGoals({ householdId: req.user.householdId, userId: req.user.id });
  const byId = new Map(goals.map((g) => [g.id, g]));
  const rows = [];
  for (const a of allocations) {
    const n = Number(a?.amount);
    if (!byId.has(a?.goalId)) return res.status(400).json({ error: "Obiettivo non valido nel riparto" });
    if (!Number.isFinite(n) || n <= 0) continue;
    rows.push({ goalId: a.goalId, userId: req.user.id, amount: Number(n.toFixed(2)), date, note: note || "Distribuisci" });
  }
  if (rows.length === 0) return res.status(400).json({ error: "Nessun importo > 0 nel riparto" });
  await prisma.goalContribution.createMany({ data: rows });
  const updated = await listGoals({ householdId: req.user.householdId, userId: req.user.id });
  emit(req.user.householdId, "allocated", { goals: updated });
  res.status(201).json({ goals: updated, summary: summarizeGoals(updated), contributed: rows.length });
});

export default router;
