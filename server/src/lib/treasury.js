// Motore di tesoreria: profilo finanziario dallo storico transazioni e
// simulatore di autofinanziamento dal fondo tasse. Matematica deterministica,
// nessuna AI. Le stime NON sono consulenza fiscale.
//
// Capacità di rientro "user" (default): entrate personali − tasse accantonate
// personali − quota equa delle spese di famiglia (spese household / n. membri).
// Con scope "household" si considerano le entrate e le spese di tutta la famiglia.
import { prisma } from "./prisma.js";

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

/**
 * Simulazione: "posso prendere `amount` € dal fondo tasse e rientrare prima
 * della prossima scadenza?" Tre scenari dai percentili della capacità mensile.
 */
export async function simulateSelfFinancing({ userId, householdId, amount, scope = "user", buffer = 0.1 }) {
  const profile = await buildFinancialProfile({ userId, householdId, scope, buffer });
  if (!profile.ok) return profile;

  const today = new Date();
  const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const [pendingSavings, nextDeadline, overdueCount] = await Promise.all([
    prisma.taxSaving.findMany({
      where: { transferred: false, transaction: { userId } },
      select: { amount: true },
    }),
    prisma.taxDeadline.findFirst({
      where: { userId, paid: false, dueDate: { gte: todayUTC } },
      orderBy: { dueDate: "asc" },
      select: { id: true, name: true, type: true, dueDate: true, expectedAmount: true },
    }),
    prisma.taxDeadline.count({
      where: { userId, paid: false, dueDate: { lt: todayUTC } },
    }),
  ]);

  const fundAvailable = pendingSavings.reduce((s, t) => s + t.amount, 0);

  const scenarioDefs = [
    { name: "pessimista", monthlyCapacity: profile.capacity.buffered.p25 },
    { name: "realistico", monthlyCapacity: profile.capacity.buffered.p50 },
    { name: "ottimista", monthlyCapacity: profile.capacity.buffered.p75 },
  ];

  const scenarios = scenarioDefs.map(({ name, monthlyCapacity }) => {
    if (monthlyCapacity == null || monthlyCapacity <= 0) {
      return { name, monthlyCapacity, monthsToRepay: null, repaidBy: null, verdict: "NO" };
    }
    const monthsToRepay = Math.ceil(amount / monthlyCapacity);
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
    return { name, monthlyCapacity, monthsToRepay, repaidBy, verdict };
  });

  const byName = Object.fromEntries(scenarios.map((s) => [s.name, s.verdict]));
  let overallVerdict;
  if (byName.realistico === "OK") overallVerdict = "OK";
  else if (byName.realistico === "RISCHIO") overallVerdict = "RISCHIO";
  else if (byName.ottimista === "OK" || byName.ottimista === "RISCHIO") overallVerdict = "RISCHIO";
  else overallVerdict = "NO";

  return {
    ok: true,
    amount,
    scope,
    fundAvailable,
    exceedsFund: amount > fundAvailable,
    overdueCount,
    nextDeadline,
    scenarios,
    overallVerdict,
    profile: {
      monthsAnalyzed: profile.monthsAnalyzed,
      medianMonthlyIncome: profile.medianMonthlyIncome,
      avgMonthlyExpense: profile.avgMonthlyExpense,
      effectiveTaxPercent: profile.effectiveTaxPercent,
      buffer: profile.buffer,
    },
    disclaimer: DISCLAIMER,
  };
}
