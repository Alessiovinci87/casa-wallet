// Motore ricorrenze (entrate/uscite ricorrenti). Matematica deterministica su
// date UTC-mezzanotte (le transazioni del client sono salvate così).
//
// - occurrenceAt(rule, k): k-esima occorrenza dalla data di partenza
// - firstOccurrenceOnOrAfter(rule, date): prima occorrenza ≥ date (nextRunAt)
// - occurrencesBetween(rule, from, to): occorrenze materializzate (non salvate)
// - monthlyEquivalent(rule): importo mensile equivalente (per obiettivi/forecast)
// - runDueRules(): il cron posta (autoPost) o mette in attesa di conferma
import { prisma } from "./prisma.js";
import { broadcast } from "./ws.js";
import { sendPushToHousehold } from "./push.js";

export const FREQUENCIES = new Set(["WEEKLY", "MONTHLY", "BIMONTHLY", "QUARTERLY", "SEMIANNUAL", "YEARLY"]);
const MONTHS_PER_FREQ = { MONTHLY: 1, BIMONTHLY: 2, QUARTERLY: 3, SEMIANNUAL: 6, YEARLY: 12 };
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const eur = (n) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n || 0);

/** Mezzanotte UTC del giorno corrente nel fuso Europe/Rome. */
export function todayRomeUTC() {
  const str = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
  const [y, m, d] = str.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function utcDay(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysInMonth(y, m0) {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

/** Mesi per occorrenza (null per WEEKLY). */
export function monthsPerOccurrence(rule) {
  const base = MONTHS_PER_FREQ[rule.frequency];
  if (!base) return null;
  return base * Math.max(1, rule.interval || 1);
}

/** Importo mensile equivalente: amount / mesi (WEEKLY: ×52/12 diviso interval). */
export function monthlyEquivalent(rule) {
  const amount = Number(rule.amount) || 0;
  if (rule.frequency === "WEEKLY") {
    return Number(((amount * 52) / 12 / Math.max(1, rule.interval || 1)).toFixed(2));
  }
  return Number((amount / monthsPerOccurrence(rule)).toFixed(2));
}

/**
 * k-esima occorrenza (k ≥ 0). Mensili & multipli: ancorate al mese di
 * startDate, giorno = dayOfMonth clampato agli ultimi del mese (31 → ultimo,
 * febbraio incluso). Settimanali: startDate allineata al weekday, + k×7×interval.
 */
export function occurrenceAt(rule, k) {
  const start = utcDay(rule.startDate);
  const interval = Math.max(1, rule.interval || 1);

  if (rule.frequency === "WEEKLY") {
    let anchor = start;
    if (rule.weekday != null) {
      const delta = (rule.weekday - start.getUTCDay() + 7) % 7;
      anchor = new Date(start.getTime() + delta * MS_PER_DAY);
    }
    return new Date(anchor.getTime() + k * 7 * interval * MS_PER_DAY);
  }

  const step = monthsPerOccurrence(rule);
  const day = rule.dayOfMonth ?? start.getUTCDate();
  // Se nel mese di partenza il giorno è già passato, la prima occorrenza è al mese dopo.
  const y0 = start.getUTCFullYear();
  const m0 = start.getUTCMonth();
  const firstDay = Math.min(day, daysInMonth(y0, m0));
  const shift = firstDay < start.getUTCDate() ? 1 : 0;
  const monthIndex = m0 + shift + k * step;
  const y = y0 + Math.floor(monthIndex / 12);
  const m = ((monthIndex % 12) + 12) % 12;
  return new Date(Date.UTC(y, m, Math.min(day, daysInMonth(y, m))));
}

/** Prima occorrenza ≥ date (rispetta endDate: null se oltre). */
export function firstOccurrenceOnOrAfter(rule, date) {
  const target = utcDay(date);
  const end = rule.endDate ? utcDay(rule.endDate) : null;
  for (let k = 0; k < 2000; k++) {
    const occ = occurrenceAt(rule, k);
    if (end && occ > end) return null;
    if (occ >= target) return occ;
  }
  return null;
}

/** Occorrenza successiva a `after` (strettamente). */
export function nextOccurrenceAfter(rule, after) {
  return firstOccurrenceOnOrAfter(rule, new Date(utcDay(after).getTime() + MS_PER_DAY));
}

/** Occorrenze in [from, to] materializzate (max 400). */
export function occurrencesBetween(rule, from, to) {
  const out = [];
  const end = rule.endDate ? utcDay(rule.endDate) : null;
  const lo = utcDay(from);
  const hi = utcDay(to);
  for (let k = 0; k < 2000 && out.length < 400; k++) {
    const occ = occurrenceAt(rule, k);
    if (occ > hi) break;
    if (end && occ > end) break;
    if (occ >= lo) out.push(occ);
  }
  return out;
}

/** Arricchisce una regola per la risposta API. */
export function enrichRule(rule) {
  return {
    ...rule,
    monthlyEquivalent: monthlyEquivalent(rule),
    monthsPerOccurrence: monthsPerOccurrence(rule),
  };
}

function emit(householdId, action, rule) {
  broadcast(householdId, { event: "recurring_update", payload: { action, rule } });
}

/**
 * Posta l'occorrenza `occurrence` della regola come Transaction (idempotente
 * per ruleId+data). Ritorna la transazione (nuova o esistente) e un flag.
 */
export async function postOccurrence(rule, occurrence) {
  const when = utcDay(occurrence);
  const existing = await prisma.transaction.findFirst({
    where: { recurringRuleId: rule.id, date: when },
  });
  if (existing) return { transaction: existing, created: false };

  const transaction = await prisma.transaction.create({
    data: {
      userId: rule.userId,
      householdId: rule.householdId,
      amount: rule.amount,
      type: rule.type,
      category: rule.category,
      method: rule.method,
      description: rule.description ?? null,
      date: when,
      recurringRuleId: rule.id,
    },
    include: { taxSaving: true, user: { select: { id: true, name: true } } },
  });
  broadcast(rule.householdId, {
    event: "transaction_update",
    payload: { action: "created", transaction },
  });
  return { transaction, created: true };
}

/**
 * Processa una singola regola: tutte le occorrenze con nextRunAt ≤ today
 * (recupera anche i giorni saltati). Con force=true processa la prossima
 * occorrenza anche se futura (test manuale).
 */
export async function processRule(rule, { today = todayRomeUTC(), force = false } = {}) {
  const result = { ruleId: rule.id, posted: [], pending: null, deactivated: false };
  if (!rule.active) return result;
  let next = rule.nextRunAt ? utcDay(rule.nextRunAt) : firstOccurrenceOnOrAfter(rule, rule.startDate);
  let lastPostedAt = rule.lastPostedAt;
  let pendingAt = rule.pendingAt;
  let guard = 0;

  while (next && (next <= today || (force && guard === 0)) && guard < 60) {
    guard++;
    if (rule.autoPost) {
      const { created } = await postOccurrence(rule, next);
      if (created) result.posted.push(next);
      lastPostedAt = next;
    } else {
      // In attesa di conferma: se ce n'era già una non confermata viene sostituita.
      pendingAt = next;
      result.pending = next;
    }
    next = nextOccurrenceAfter(rule, next);
  }

  const data = { nextRunAt: next, lastPostedAt, pendingAt };
  if (!next) {
    data.active = false; // endDate raggiunta
    result.deactivated = true;
  }
  const updated = await prisma.recurringRule.update({ where: { id: rule.id }, data });

  if (result.pending && !rule.autoPost) {
    sendPushToHousehold(rule.householdId, {
      title: rule.type === "EXPENSE" ? "Conferma addebito" : "Conferma entrata",
      body: `${rule.description || rule.category}: ${eur(rule.amount)} del ${result.pending.toLocaleDateString("it-IT")}`,
      url: "/recurring",
    }).catch((err) => console.error("[recurrence] push fallita:", err.message));
  }
  if (result.posted.length || result.pending || result.deactivated) emit(rule.householdId, "processed", enrichRule(updated));
  return result;
}

/** Corsa giornaliera (cron 06:00): tutte le regole attive scadute. */
export async function runDueRules({ householdId, force = false } = {}) {
  const today = todayRomeUTC();
  const where = { active: true };
  if (householdId) where.householdId = householdId;
  if (!force) where.nextRunAt = { lte: today };
  const rules = await prisma.recurringRule.findMany({ where });
  const results = [];
  for (const rule of rules) {
    try {
      results.push(await processRule(rule, { today, force }));
    } catch (err) {
      console.error(`[recurrence] regola ${rule.id} fallita:`, err.message);
      results.push({ ruleId: rule.id, error: err.message });
    }
  }
  return { today, processed: results.length, results };
}
