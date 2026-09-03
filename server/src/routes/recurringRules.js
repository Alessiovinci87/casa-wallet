// Ricorrenze (entrate/uscite ricorrenti) — scoped famiglia.
// CRUD + occorrenze future materializzate + trigger cron di test + conferma/salta
// per le regole non automatiche.
import { Router } from "express";
import { resolveAccountId } from "../lib/accounts.js";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { broadcast } from "../lib/ws.js";
import {
  FREQUENCIES,
  enrichRule,
  firstOccurrenceOnOrAfter,
  nextOccurrenceAfter,
  occurrencesBetween,
  postOccurrence,
  processRule,
  runDueRules,
  todayRomeUTC,
  monthlyEquivalent,
} from "../lib/recurrence.js";

const router = Router();
router.use(authMiddleware);

const TX_TYPES = new Set(["INCOME", "EXPENSE"]);
const PAY_METHODS = new Set(["CASH", "POS", "CARD", "TRANSFER"]);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const include = { user: { select: { id: true, name: true } } };

function emit(householdId, action, rule) {
  broadcast(householdId, { event: "recurring_update", payload: { action, rule } });
}

/** Valida e normalizza il body (parziale per PUT). Ritorna { data } o { error }. */
function parseBody(body, { partial = false } = {}) {
  const b = body || {};
  const data = {};
  const need = (k) => !partial && b[k] == null;

  if (need("type") || need("amount") || need("category") || need("method") || need("frequency") || need("startDate")) {
    return { error: "Campi obbligatori: type, amount, category, method, frequency, startDate" };
  }
  if (b.type !== undefined) {
    if (!TX_TYPES.has(b.type)) return { error: "type non valido (INCOME | EXPENSE)" };
    data.type = b.type;
  }
  if (b.method !== undefined) {
    if (!PAY_METHODS.has(b.method)) return { error: "method non valido (CASH | POS | CARD | TRANSFER)" };
    data.method = b.method;
  }
  if (b.amount !== undefined) {
    const n = Number(b.amount);
    if (!Number.isFinite(n) || n <= 0) return { error: "amount deve essere un numero > 0" };
    data.amount = n;
  }
  if (b.category !== undefined) {
    if (!String(b.category).trim()) return { error: "category obbligatoria" };
    data.category = String(b.category).trim();
  }
  if (b.description !== undefined) data.description = b.description ? String(b.description).trim() : null;
  if (b.accountId !== undefined) data.accountId = b.accountId ? String(b.accountId) : null; // validato dopo (famiglia)
  if (b.accrualStart !== undefined) {
    if (!b.accrualStart) data.accrualStart = null;
    else {
      const d = new Date(b.accrualStart);
      if (Number.isNaN(d.getTime())) return { error: "accrualStart non valida" };
      data.accrualStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
  }
  if (b.frequency !== undefined) {
    if (!FREQUENCIES.has(b.frequency)) return { error: "frequency non valida" };
    data.frequency = b.frequency;
  }
  if (b.interval !== undefined) {
    const n = Number(b.interval);
    if (!Number.isInteger(n) || n < 1 || n > 24) return { error: "interval deve essere un intero 1..24" };
    data.interval = n;
  }
  if (b.dayOfMonth !== undefined) {
    if (b.dayOfMonth === null || b.dayOfMonth === "") data.dayOfMonth = null;
    else {
      const n = Number(b.dayOfMonth);
      if (!Number.isInteger(n) || n < 1 || n > 31) return { error: "dayOfMonth deve essere 1..31" };
      data.dayOfMonth = n;
    }
  }
  if (b.weekday !== undefined) {
    if (b.weekday === null || b.weekday === "") data.weekday = null;
    else {
      const n = Number(b.weekday);
      if (!Number.isInteger(n) || n < 0 || n > 6) return { error: "weekday deve essere 0..6" };
      data.weekday = n;
    }
  }
  if (b.startDate !== undefined) {
    const d = new Date(b.startDate);
    if (Number.isNaN(d.getTime())) return { error: "startDate non valida" };
    data.startDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  if (b.endDate !== undefined) {
    if (b.endDate === null || b.endDate === "") data.endDate = null;
    else {
      const d = new Date(b.endDate);
      if (Number.isNaN(d.getTime())) return { error: "endDate non valida" };
      data.endDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
  }
  if (b.autoPost !== undefined) data.autoPost = Boolean(b.autoPost);
  if (b.active !== undefined) data.active = Boolean(b.active);
  return { data };
}

// GET /api/recurring-rules?active=true
router.get("/", async (req, res) => {
  const where = { householdId: req.user.householdId };
  if (req.query.active === "true") where.active = true;
  const rules = await prisma.recurringRule.findMany({
    where,
    include,
    orderBy: [{ active: "desc" }, { nextRunAt: "asc" }],
  });
  const enriched = rules.map(enrichRule);
  const totals = { EXPENSE: 0, INCOME: 0 };
  const year = { EXPENSE: 0, INCOME: 0 };
  for (const r of enriched) if (r.active) { totals[r.type] += r.monthlyEquivalent; year[r.type] += r.remainingThisYear.total; }
  res.json({
    rules: enriched,
    monthlyFixedExpense: Number(totals.EXPENSE.toFixed(2)),
    monthlyFixedIncome: Number(totals.INCOME.toFixed(2)),
    yearRemainingExpense: Number(year.EXPENSE.toFixed(2)),
    yearRemainingIncome: Number(year.INCOME.toFixed(2)),
  });
});

// GET /api/recurring-rules/upcoming?days=90 — occorrenze future materializzate
// (non salvate), incluse quelle in attesa di conferma. Ordinate per data.
router.get("/upcoming", async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 90));
  const today = todayRomeUTC();
  const to = new Date(today.getTime() + days * MS_PER_DAY);
  const rules = await prisma.recurringRule.findMany({
    where: { householdId: req.user.householdId, active: true },
  });
  const events = [];
  for (const rule of rules) {
    const from = rule.nextRunAt && rule.nextRunAt > today ? rule.nextRunAt : today;
    for (const date of occurrencesBetween(rule, from, to)) {
      events.push({
        ruleId: rule.id,
        date,
        type: rule.type,
        amount: rule.amount,
        category: rule.category,
        description: rule.description,
        autoPost: rule.autoPost,
        pending: false,
      });
    }
    if (rule.pendingAt) {
      events.push({
        ruleId: rule.id,
        date: rule.pendingAt,
        type: rule.type,
        amount: rule.amount,
        category: rule.category,
        description: rule.description,
        autoPost: false,
        pending: true,
      });
    }
  }
  events.sort((a, b) => a.date - b.date);
  res.json({ from: today, to, days, events });
});

// POST /api/recurring-rules/run-due { force? } — trigger di test del cron
// (solo la famiglia del chiamante). force = processa la prossima occorrenza
// di ogni regola attiva anche se futura.
router.post("/run-due", async (req, res) => {
  const result = await runDueRules({
    householdId: req.user.householdId,
    force: Boolean(req.body?.force),
  });
  res.json(result);
});

// POST /api/recurring-rules — crea la regola e la processa subito: se la prima
// occorrenza è già dovuta la transazione nasce ora (o va in attesa di conferma).
// postFirst=true (dal form transazione): parte dalla startDate anche se passata
// (la transazione che l'utente stava inserendo). Altrimenti parte da oggi.
router.post("/", async (req, res) => {
  const parsed = parseBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { data } = parsed;
  const today = todayRomeUTC();
  const from = req.body?.postFirst ? data.startDate : data.startDate > today ? data.startDate : today;
  const draft = { ...data, interval: data.interval ?? 1 };
  const nextRunAt = firstOccurrenceOnOrAfter(draft, from);
  if (!nextRunAt) return res.status(400).json({ error: "Nessuna occorrenza: endDate precede la prima ricorrenza" });

  // linkTransactionIds (import CSV): le righe storiche diventano occorrenze della regola
  // (finiscono in Fisse) e la prima occorrenza da postare è quella dopo l'ultima collegata.
  const linkIds = Array.isArray(req.body?.linkTransactionIds) ? req.body.linkTransactionIds.filter((x) => typeof x === "string") : [];
  let lastLinked = null;
  if (linkIds.length) {
    const linked = await prisma.transaction.findMany({
      where: { id: { in: linkIds }, householdId: req.user.householdId, type: data.type },
      select: { id: true, date: true },
    });
    for (const t of linked) if (!lastLinked || t.date > lastLinked) lastLinked = t.date;
  }
  const startFrom = lastLinked && lastLinked >= today ? new Date(lastLinked.getTime() + MS_PER_DAY) : nextRunAt;
  try { if (data.accountId) data.accountId = await resolveAccountId(req.user.householdId, data.accountId); } catch (err) { return res.status(400).json({ error: err.message }); }
  const rule = await prisma.recurringRule.create({
    data: {
      ...data,
      nextRunAt: lastLinked ? firstOccurrenceOnOrAfter(draft, startFrom > today ? startFrom : today) : nextRunAt,
      lastPostedAt: lastLinked,
      userId: req.user.id,
      householdId: req.user.householdId,
    },
  });
  if (linkIds.length) {
    await prisma.transaction.updateMany({
      where: { id: { in: linkIds }, householdId: req.user.householdId, type: data.type },
      data: { recurringRuleId: rule.id },
    });
    broadcast(req.user.householdId, { event: "transaction_update", payload: { action: "linked", count: linkIds.length } });
  }
  const run = await processRule(rule, { today });
  const fresh = await prisma.recurringRule.findUnique({ where: { id: rule.id }, include });
  const out = enrichRule(fresh);
  emit(req.user.householdId, "created", out);
  res.status(201).json({ ...out, posted: run.posted, pending: run.pending });
});

// PUT /api/recurring-rules/:id — update parziale; se cambia la pianificazione
// ricalcola nextRunAt (dopo l'ultima postata, mai nel passato).
router.put("/:id", async (req, res) => {
  const existing = await prisma.recurringRule.findFirst({
    where: { id: req.params.id, householdId: req.user.householdId },
  });
  if (!existing) return res.status(404).json({ error: "Ricorrenza non trovata" });

  const parsed = parseBody(req.body, { partial: true });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { data } = parsed;
  try { if (data.accountId) data.accountId = await resolveAccountId(req.user.householdId, data.accountId); } catch (err) { return res.status(400).json({ error: err.message }); }

  const scheduleKeys = ["frequency", "interval", "dayOfMonth", "weekday", "startDate", "endDate", "active"];
  const merged = { ...existing, ...data };
  if (scheduleKeys.some((k) => data[k] !== undefined)) {
    const today = todayRomeUTC();
    const floor = merged.lastPostedAt
      ? new Date(Math.max(today.getTime(), merged.lastPostedAt.getTime() + MS_PER_DAY))
      : today;
    data.nextRunAt = firstOccurrenceOnOrAfter(merged, floor > merged.startDate ? floor : merged.startDate);
    if (!data.nextRunAt && data.active !== false) {
      return res.status(400).json({ error: "Nessuna occorrenza futura con questa pianificazione" });
    }
  }
  const rule = await prisma.recurringRule.update({ where: { id: existing.id }, data, include });
  const out = enrichRule(rule);
  emit(req.user.householdId, "updated", out);
  res.json(out);
});

// DELETE /api/recurring-rules/:id — le transazioni già create restano (link a null).
router.delete("/:id", async (req, res) => {
  const existing = await prisma.recurringRule.findFirst({
    where: { id: req.params.id, householdId: req.user.householdId },
  });
  if (!existing) return res.status(404).json({ error: "Ricorrenza non trovata" });
  await prisma.$transaction([
    prisma.transaction.updateMany({ where: { recurringRuleId: existing.id }, data: { recurringRuleId: null } }),
    prisma.recurringRule.delete({ where: { id: existing.id } }),
  ]);
  emit(req.user.householdId, "deleted", { id: existing.id });
  res.json({ ok: true, id: existing.id });
});

// POST /api/recurring-rules/:id/confirm { amount?, date? } — crea la transazione
// dell'occorrenza in attesa (autoPost=false). 409 se nulla in attesa.
router.post("/:id/confirm", async (req, res) => {
  const rule = await prisma.recurringRule.findFirst({
    where: { id: req.params.id, householdId: req.user.householdId },
  });
  if (!rule) return res.status(404).json({ error: "Ricorrenza non trovata" });
  if (!rule.pendingAt) return res.status(409).json({ error: "Nessun addebito in attesa di conferma" });

  const amount = req.body?.amount != null ? Number(req.body.amount) : rule.amount;
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "amount deve essere > 0" });
  const date = req.body?.date ? new Date(req.body.date) : rule.pendingAt;
  if (Number.isNaN(date.getTime())) return res.status(400).json({ error: "date non valida" });

  const { transaction, created } = await postOccurrence({ ...rule, amount }, date);
  const updated = await prisma.recurringRule.update({
    where: { id: rule.id },
    data: { pendingAt: null, lastPostedAt: rule.pendingAt },
    include,
  });
  emit(req.user.householdId, "confirmed", enrichRule(updated));
  res.status(created ? 201 : 200).json({ rule: enrichRule(updated), transaction });
});

// POST /api/recurring-rules/:id/skip — scarta l'occorrenza in attesa.
router.post("/:id/skip", async (req, res) => {
  const rule = await prisma.recurringRule.findFirst({
    where: { id: req.params.id, householdId: req.user.householdId },
  });
  if (!rule) return res.status(404).json({ error: "Ricorrenza non trovata" });
  const updated = await prisma.recurringRule.update({
    where: { id: rule.id },
    data: { pendingAt: null },
    include,
  });
  emit(req.user.householdId, "skipped", enrichRule(updated));
  res.json(enrichRule(updated));
});

export default router;
