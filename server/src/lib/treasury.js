// Motore di tesoreria: profilo finanziario dallo storico transazioni e
// simulatore di autofinanziamento dal fondo tasse. Matematica deterministica,
// nessuna AI. Le stime NON sono consulenza fiscale.
//
// Capacità di rientro "user" (default): entrate personali − tasse accantonate
// personali − quota equa delle spese di famiglia (spese household / n. membri).
// Con scope "household" si considerano le entrate e le spese di tutta la famiglia.
import { prisma } from "./prisma.js";
import { pendingTaxFund } from "./taxFund.js";
import { monthlyEquivalent } from "./recurrence.js";
import { computeInstallmentPlan } from "./repaymentPlan.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const DISCLAIMER = "Stima basata sullo storico, non è consulenza fiscale.";

/**
 * Percentile p (0..1) con interpolazione lineare su array GIÀ ordinato.
 * n=0 → null; n=1 → l'unico valore.
 */
export function percentile(sortedValues, p) {
  const n = sortedValues.length;
  if (n === 0) return null;
  if (n === 1) return sortedValues[0];
  const idx = (n - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (idx - lo);
}

/**
 * % minima suggerita di accantonamento (forfettario e assimilati):
 * coefficiente di redditività × (imposta + INPS), arrotondata per eccesso.
 * null se manca uno dei tre parametri.
 */
export function computeSuggestedMinPercent({ coeffRedditivita, aliquotaImposta, aliquotaInps } = {}) {
  if (coeffRedditivita == null || aliquotaImposta == null || aliquotaInps == null) return null;
  return Math.ceil(coeffRedditivita * (aliquotaImposta + aliquotaInps));
}

const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * Profilo finanziario su una finestra di mesi PIENI (esclude il mese corrente,
 * parziale). Ritorna { ok:false, reason:"DATI_INSUFFICIENTI" } con meno di 3
 * mesi che contengono transazioni.
 */
export async function buildFinancialProfile({
  userId,
  householdId,
  scope = "user",
  months = 12,
  buffer = 0.1,
}) {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); // 1° del mese corrente
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, 1));

  const [transactions, memberCount] = await Promise.all([
    prisma.transaction.findMany({
      where: { householdId, date: { gte: start, lt: end } },
      select: { userId: true, amount: true, type: true, taxAmount: true, category: true, date: true },
    }),
    prisma.user.count({ where: { householdId } }),
  ]);

  // Bucket mensili. Un mese è "valido" se ha almeno una transazione (di chiunque).
  const buckets = new Map(); // key YYYY-MM → { income, taxSetAside, expense }
  for (const t of transactions) {
    const key = monthKey(new Date(t.date));
    const b = buckets.get(key) || { income: 0, taxSetAside: 0, expense: 0 };
    const mine = scope === "household" || t.userId === userId;
    if (t.type === "INCOME") {
      if (mine) {
        b.income += t.amount;
        b.taxSetAside += t.taxAmount || 0;
      }
    } else {
      b.expense += t.amount; // le spese sono sempre di famiglia
    }
    buckets.set(key, b);
  }

  const monthsAnalyzed = buckets.size;
  if (monthsAnalyzed < 3) {
    return { ok: false, reason: "DATI_INSUFFICIENTI", monthsAnalyzed, scope };
  }

  // Quota spese: con scope "user" si divide equamente tra i membri.
  const expenseShare = scope === "user" ? 1 / Math.max(memberCount, 1) : 1;

  const series = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, b]) => {
      const [year, month] = key.split("-").map(Number);
      const expense = b.expense * expenseShare;
      return {
        year,
        month,
        income: b.income,
        taxSetAside: b.taxSetAside,
        expense,
        capacity: b.income - b.taxSetAside - expense,
      };
    });

  const incomes = series.map((m) => m.income);
  const expenses = series.map((m) => m.expense);
  const capacities = series.map((m) => m.capacity).sort((a, b) => a - b);
  const totalIncome = incomes.reduce((s, v) => s + v, 0);
  const totalTax = series.reduce((s, m) => s + m.taxSetAside, 0);

  const sortedIncomes = [...incomes].sort((a, b) => a - b);
  const medianMonthlyIncome = percentile(sortedIncomes, 0.5);
  const avgMonthlyExpense = expenses.reduce((s, v) => s + v, 0) / series.length;
  const effectiveTaxPercent = totalIncome > 0 ? (totalTax / totalIncome) * 100 : null;

  // Spese ricorrenti: categoria presente in ≥75% dei mesi e variazione contenuta
  // (coefficiente di variazione ≤ 0.35). Calcolate sui totali household, poi
  // riportate alla quota dello scope.
  const byCategory = new Map(); // category → Map(monthKey → total)
  for (const t of transactions) {
    if (t.type !== "EXPENSE") continue;
    const key = monthKey(new Date(t.date));
    const cat = byCategory.get(t.category) || new Map();
    cat.set(key, (cat.get(key) || 0) + t.amount);
    byCategory.set(t.category, cat);
  }
  const recurring = [];
  let recurringTotal = 0;
  for (const [category, perMonth] of byCategory) {
    const values = [...perMonth.values()];
    if (perMonth.size / monthsAnalyzed < 0.75) continue;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    if (mean <= 0) continue;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    const cv = Math.sqrt(variance) / mean;
    if (cv <= 0.35) {
      const avgMonthly = mean * expenseShare;
      recurring.push({ category, avgMonthly: Number(avgMonthly.toFixed(2)) });
      recurringTotal += avgMonthly;
    }
  }
  recurring.sort((a, b) => b.avgMonthly - a.avgMonthly);

  const cap = {
    p25: percentile(capacities, 0.25),
    p50: percentile(capacities, 0.5),
    p75: percentile(capacities, 0.75),
  };
  // Il buffer di sicurezza riduce solo le capacità positive.
  const applyBuffer = (v) => (v != null && v > 0 ? v * (1 - buffer) : v);

  return {
    ok: true,
    scope,
    monthsAnalyzed,
    buffer,
    memberCount,
    series,
    medianMonthlyIncome,
    avgMonthlyExpense,
    effectiveTaxPercent,
    recurring,
    recurringTotal: Number(recurringTotal.toFixed(2)),
    variableAvgMonthly: Number((avgMonthlyExpense - recurringTotal).toFixed(2)),
    capacity: {
      ...cap,
      buffered: { p25: applyBuffer(cap.p25), p50: applyBuffer(cap.p50), p75: applyBuffer(cap.p75) },
    },
  };
}

/** Aggiunge n mesi a una data (UTC). */
function addMonths(date, n) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
}

// Incassi attesi: fatture EMESSE non ancora incassate, con data d'incasso
// stimata dallo storico. Il ritardo mediano richiede ≥3 fatture già incassate;
// sotto quella soglia si usa un default prudenziale di 45 giorni.
const DEFAULT_COLLECTION_DELAY_DAYS = 45;
const MIN_DELAY_SAMPLES = 3;

export async function computeExpectedCollections({ userId, todayUTC, fallbackTaxPercent }) {
  const [pending, collected, fiscalProfile] = await Promise.all([
    prisma.invoice.findMany({
      where: { userId, status: "EMESSA" },
      select: { date: true, dueDate: true, netToPay: true },
    }),
    prisma.invoice.findMany({
      where: { userId, status: "INCASSATA", collectedAt: { not: null } },
      select: { date: true, collectedAt: true },
      orderBy: { collectedAt: "desc" },
      take: 24, // le più recenti: i tempi d'incasso cambiano nel tempo
    }),
    prisma.fiscalProfile.findUnique({
      where: { userId },
      select: { defaultTaxPercent: true },
    }),
  ]);

  if (pending.length === 0) return null;

  const delays = collected
    .map((inv) => Math.max(0, Math.round((inv.collectedAt - inv.date) / MS_PER_DAY)))
    .sort((a, b) => a - b);
  const delayDays =
    delays.length >= MIN_DELAY_SAMPLES
      ? Math.round(percentile(delays, 0.5))
      : DEFAULT_COLLECTION_DELAY_DAYS;
  const delaySource = delays.length >= MIN_DELAY_SAMPLES ? "storico" : "default";

  // All'incasso una quota va al salvadanaio tasse: come capacità di rientro
  // conta solo il netto dopo l'accantonamento.
  const taxPercent = fiscalProfile?.defaultTaxPercent ?? fallbackTaxPercent ?? 0;

  const items = pending.map((inv) => {
    const estimated = inv.dueDate ?? new Date(inv.date.getTime() + delayDays * MS_PER_DAY);
    const expectedAt = estimated > todayUTC ? estimated : todayUTC;
    return { expectedAt, net: inv.netToPay * (1 - taxPercent / 100) };
  });
  items.sort((a, b) => a.expectedAt - b.expectedAt);

  const gross = pending.reduce((s, inv) => s + inv.netToPay, 0);
  const net = items.reduce((s, it) => s + it.net, 0);

  return {
    count: pending.length,
    gross: Number(gross.toFixed(2)),
    net: Number(net.toFixed(2)),
    taxPercent,
    delayDays,
    delaySource,
    nextExpectedAt: items[0].expectedAt,
    items,
  };
}

/**
 * Mesi per rientrare di `amount` con capacità mensile + incassi attesi che
 * arrivano lungo la strada (cumulati alla fine di ogni mese). Ritorna null se
 * non si rientra entro 10 anni (non dovrebbe accadere con capacità > 0).
 */
function monthsToRepayWithCollections(amount, monthlyCapacity, collections, todayUTC) {
  let collectedSoFar = 0;
  let idx = 0;
  for (let m = 1; m <= 120; m++) {
    const windowEnd = addMonths(todayUTC, m);
    while (idx < collections.length && collections[idx].expectedAt <= windowEnd) {
      collectedSoFar += collections[idx].net;
      idx += 1;
    }
    if (monthlyCapacity * m + collectedSoFar >= amount) return m;
  }
  return null;
}

/**
 * Simulazione: "posso prendere `amount` € dal fondo tasse e rientrare prima
 * della prossima scadenza?" Tre scenari dai percentili della capacità mensile.
 */
export async function simulateSelfFinancing({ userId, householdId, amount, scope = "user", buffer = 0.1 }) {
  let profile = await buildFinancialProfile({ userId, householdId, scope, buffer });
  // Fallback dichiarativo: senza 3 mesi di storico la capacità viene dai dati
  // inseriti (ricorrenze, obiettivi, budget). Mai un NO muto.
  let declared = null;
  if (!profile.ok) {
    declared = await buildDeclaredCapacity({ householdId, userId, buffer });
    profile = declared.profile;
  }

  const today = new Date();
  const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const [fundAvailable, nextDeadline, overdueCount] = await Promise.all([
    pendingTaxFund(userId),
    prisma.taxDeadline.findFirst({
      where: { userId, paid: false, dueDate: { gte: todayUTC } },
      orderBy: { dueDate: "asc" },
      select: { id: true, name: true, type: true, dueDate: true, expectedAmount: true },
    }),
    prisma.taxDeadline.count({
      where: { userId, paid: false, dueDate: { lt: todayUTC } },
    }),
  ]);

  // Incassi attesi (fatture EMESSE): accelerano il rientro negli scenari
  // realistico e ottimista; lo scenario pessimista li ignora per prudenza.
  const expectedCollections = await computeExpectedCollections({
    userId,
    todayUTC,
    fallbackTaxPercent: profile.effectiveTaxPercent,
  });

  const scenarioDefs = [
    { name: "pessimista", monthlyCapacity: profile.capacity.buffered.p25, useCollections: false },
    { name: "realistico", monthlyCapacity: profile.capacity.buffered.p50, useCollections: true },
    { name: "ottimista", monthlyCapacity: profile.capacity.buffered.p75, useCollections: true },
  ];

  const scenarios = scenarioDefs.map(({ name, monthlyCapacity, useCollections }) => {
    const withCollections = useCollections && expectedCollections != null;
    if (monthlyCapacity == null || monthlyCapacity <= 0) {
      return { name, monthlyCapacity, monthsToRepay: null, repaidBy: null, verdict: "NO", withCollections: false };
    }
    const monthsToRepay = withCollections
      ? monthsToRepayWithCollections(amount, monthlyCapacity, expectedCollections.items, todayUTC)
      : Math.ceil(amount / monthlyCapacity);
    if (monthsToRepay == null) {
      return { name, monthlyCapacity, monthsToRepay: null, repaidBy: null, verdict: "NO", withCollections };
    }
    const repaidBy = addMonths(todayUTC, monthsToRepay);
    let verdict;
    if (!nextDeadline) {
      verdict = "OK";
    } else if (repaidBy <= nextDeadline.dueDate) {
      verdict = "OK";
    } else if (repaidBy <= addMonths(new Date(nextDeadline.dueDate), 1)) {
      verdict = "RISCHIO";
    } else {
      verdict = "NO";
    }
    return { name, monthlyCapacity, monthsToRepay, repaidBy, verdict, withCollections };
  });

  const byName = Object.fromEntries(scenarios.map((s) => [s.name, s.verdict]));
  let overallVerdict;
  if (byName.realistico === "OK") overallVerdict = "OK";
  else if (byName.realistico === "RISCHIO") overallVerdict = "RISCHIO";
  else if (byName.ottimista === "OK" || byName.ottimista === "RISCHIO") overallVerdict = "RISCHIO";
  else overallVerdict = "NO";

  // Piano di rientro proposto: rate nei mesi pieni fino alla prossima scadenza.
  const repaymentPlan = nextDeadline
    ? { ...computeInstallmentPlan({ amount, takenAt: todayUTC, dueDate: nextDeadline.dueDate }), fundAfter: Number((fundAvailable - amount).toFixed(2)) }
    : null;

  return {
    ok: true,
    amount,
    scope,
    basis: declared ? "dichiarato" : "storico",
    basisLabel: declared ? "stima da dati dichiarati" : `stima dallo storico (${profile.monthsAnalyzed} mesi)`,
    declared: declared ? declared.summary : null,
    missing: declared ? declared.missing : [],
    fundAvailable,
    exceedsFund: amount > fundAvailable,
    overdueCount,
    nextDeadline,
    repaymentPlan,
    // Metadati per la UI (senza la lista items, interna alla simulazione).
    expectedCollections: expectedCollections
      ? {
          count: expectedCollections.count,
          gross: expectedCollections.gross,
          net: expectedCollections.net,
          taxPercent: expectedCollections.taxPercent,
          delayDays: expectedCollections.delayDays,
          delaySource: expectedCollections.delaySource,
          nextExpectedAt: expectedCollections.nextExpectedAt,
        }
      : null,
    scenarios,
    overallVerdict,
    profile: {
      monthsAnalyzed: profile.monthsAnalyzed,
      medianMonthlyIncome: profile.medianMonthlyIncome,
      avgMonthlyExpense: profile.avgMonthlyExpense,
      effectiveTaxPercent: profile.effectiveTaxPercent,
      buffer: profile.buffer,
    },
    disclaimer: declared ? DECLARED_DISCLAIMER : DISCLAIMER,
  };
}

export const DECLARED_DISCLAIMER = "Stima da dati dichiarati (ricorrenze, obiettivi, budget): con 3 mesi di storico passa alla stima dallo storico. Non è consulenza fiscale.";

/**
 * Capacità mensile "dichiarata" (fallback sotto i 3 mesi di storico):
 *   entrate ricorrenti (mensilizzate) − uscite ricorrenti (mensilizzate)
 *   − quote obiettivi del mese − budget variabili per categoria.
 * Gli incassi attesi dalle fatture EMESSE entrano nella simulazione come
 * somme una tantum (come nello scenario storico). Scenari: pessimista = 75%
 * senza incassi, realistico = capacità − buffer, ottimista = capacità piena.
 */
export async function buildDeclaredCapacity({ householdId, userId, buffer = 0.1 }) {
  const { listGoals } = await import("./goals.js");
  const [rules, goals, budgets] = await Promise.all([
    prisma.recurringRule.findMany({ where: { householdId, active: true } }),
    listGoals({ householdId, userId }),
    prisma.categoryBudget.findMany({ where: { householdId } }),
  ]);
  const r2 = (n) => Number((Math.round(n * 100) / 100).toFixed(2));
  const income = r2(rules.filter((r) => r.type === "INCOME").reduce((s, r) => s + monthlyEquivalent(r), 0));
  const fixed = r2(rules.filter((r) => r.type === "EXPENSE").reduce((s, r) => s + monthlyEquivalent(r), 0));
  const goalsQuota = r2(goals.filter((g) => g.active && g.status !== "DONE").reduce((s, g) => s + (g.catchUpQuota ?? g.monthlyQuota ?? 0), 0));
  const budgetsTotal = r2(budgets.reduce((s, b) => s + (b.amount || 0), 0));
  const capacity = r2(income - fixed - goalsQuota - budgetsTotal);
  const pendingInvoices = await prisma.invoice.count({ where: { userId, status: "EMESSA" } });
  const missing = [];
  if (income === 0 && pendingInvoices === 0) missing.push("entrate: aggiungi una ricorrenza in entrata o importa una fattura emessa");
  if (budgets.length === 0) missing.push("budget delle spese variabili (Altro → Budget): senza, le variabili contano zero");
  const cap = capacity > 0 ? capacity : null;
  return {
    missing,
    summary: { income, fixed, goalsQuota, budgets: budgetsTotal, capacity, pendingInvoices },
    profile: {
      ok: true,
      basis: "dichiarato",
      monthsAnalyzed: 0,
      buffer,
      medianMonthlyIncome: income,
      avgMonthlyExpense: r2(fixed + budgetsTotal),
      effectiveTaxPercent: null,
      capacity: {
        p25: cap ? r2(cap * 0.75) : cap, p50: cap, p75: cap,
        buffered: { p25: cap ? r2(cap * 0.75) : cap, p50: cap ? r2(cap * (1 - buffer)) : cap, p75: cap },
      },
    },
  };
}
