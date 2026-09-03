// Disponibile reale della famiglia:
//   saldo effettivo
//   − tasse accantonate non trasferite (TaxSaving pending di tutti i membri)
//   − somme parcheggiate negli Obiettivi
//   − uscite ricorrenti già dovute da qui a fine mese (non ancora registrate)
//   − prestiti interni aperti dal fondo tasse (quella parte del saldo è già impegnata)
// Il saldo effettivo parte dal punto zero (Household.openingBalance alla data)
// oppure, senza punto zero, dalla somma di tutte le transazioni.
import { prisma } from "./prisma.js";
import { accrualInfo, accruedForPeriodic, monthlyEquivalent, monthsPerOccurrence, occurrencesBetween, todayRomeUTC } from "./recurrence.js";
import { computeAccountBalances } from "./accounts.js";

const round2 = (n) => Number((Math.round(n * 100) / 100).toFixed(2));
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Saldo effettivo: somma dei conti (ognuno: opening + Σ INCOME − Σ EXPENSE dalla sua data). */
export async function computeBalance(household, today = todayRomeUTC()) {
  return computeAccountBalances(household.id, today);
}

/** Vecchio calcolo a livello famiglia (senza conti); tenuto per riferimento/test. */
export async function computeHouseholdBalance(household, today = todayRomeUTC()) {
  // Fino a oggi incluso: una transazione datata nel futuro (es. rata già registrata)
  // non è ancora uscita dal conto e vive nella previsione, non nel saldo.
  const endOfToday = new Date(today.getTime() + MS_PER_DAY - 1);
  const where = { householdId: household.id, date: { lte: endOfToday } };
  if (household.openingBalanceDate) where.date.gte = household.openingBalanceDate;
  const [inc, exp] = await Promise.all([
    prisma.transaction.aggregate({ where: { ...where, type: "INCOME" }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { ...where, type: "EXPENSE" }, _sum: { amount: true } }),
  ]);
  const income = inc._sum.amount || 0;
  const expense = exp._sum.amount || 0;
  const opening = household.openingBalance ?? 0;
  return { balance: round2(opening + income - expense), opening, income: round2(income), expense: round2(expense) };
}

/** Uscite ricorrenti dovute da domani a fine mese (+ occorrenze in attesa di conferma). */
export async function computeCommittedUntilMonthEnd(householdId, today = todayRomeUTC()) {
  const rules = await prisma.recurringRule.findMany({ where: { householdId, active: true, type: "EXPENSE" } });
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  const items = [];
  for (const rule of rules) {
    // Le spese periodiche (ogni 2+ mesi) sono coperte dall'accantonamento mensile
    // (vedi computeAvailable), non dal blocco "entro fine mese".
    if ((monthsPerOccurrence(rule) || 1) > 1 && !rule.pendingAt) continue;
    if (rule.pendingAt) {
      items.push({ ruleId: rule.id, accountId: rule.accountId ?? null, description: rule.description || rule.category, date: rule.pendingAt, amount: rule.amount, pending: true });
    }
    // Da nextRunAt (mai prima di domani: oggi il cron ha già postato) a fine mese.
    const from = new Date(Math.max(today.getTime() + MS_PER_DAY, rule.nextRunAt ? rule.nextRunAt.getTime() : 0));
    if (from > monthEnd) continue;
    for (const date of occurrencesBetween(rule, from, monthEnd)) {
      items.push({ ruleId: rule.id, accountId: rule.accountId ?? null, description: rule.description || rule.category, date, amount: rule.amount, pending: false });
    }
  }
  items.sort((a, b) => a.date - b.date);
  return { total: round2(items.reduce((s, i) => s + i.amount, 0)), items, monthEnd };
}

export async function computeAvailable({ householdId, userId }) {
  const today = todayRomeUTC();
  const household = await prisma.household.findUnique({ where: { id: householdId } });
  if (!household) throw new Error("Famiglia non trovata");

  const [bal, taxAgg, goals, committed, fixedRules, loansAgg] = await Promise.all([
    computeBalance(household, today),
    prisma.taxSaving.aggregate({
      where: { transferred: false, transaction: { householdId } },
      _sum: { amount: true },
    }),
    // Tutti gli obiettivi della famiglia (anche personali di altri membri): i
    // soldi parcheggiati sono comunque sul conto condiviso.
    prisma.savingsGoal.findMany({
      where: { householdId, active: true },
      include: { contributions: { select: { amount: true } } },
    }),
    computeCommittedUntilMonthEnd(householdId, today),
    prisma.recurringRule.findMany({ where: { householdId, active: true, type: "EXPENSE" } }),
    prisma.internalLoan.aggregate({
      where: { status: { in: ["OPEN", "LATE"] }, user: { householdId } },
      _sum: { amount: true, repaid: true },
    }),
  ]);

  const taxPending = round2(taxAgg._sum.amount || 0);
  const goalsParked = round2(goals.reduce((s, g) => s + Math.max(0, g.contributions.reduce((a, c) => a + c.amount, 0)), 0));
  const loansOutstanding = round2((loansAgg._sum.amount || 0) - (loansAgg._sum.repaid || 0));

  // Fisse mensili equivalenti: soglia del colore (giallo sotto il 20%).
  const fixedMonthly = round2(fixedRules.reduce((s, r) => s + monthlyEquivalent(r), 0));
  // Spese periodiche (bimestrali, semestrali, annuali): quota maturata finora, così
  // la rata semestrale pesa un sesto al mese e non tutta nel mese della scadenza.
  const periodicItems = fixedRules
    .filter((r) => (monthsPerOccurrence(r) || 1) > 1 && !r.pendingAt)
    .map((r) => { const a = accrualInfo(r, today); return { ruleId: r.id, description: r.description || r.category, amount: r.amount, monthlyEquivalent: a.monthlyQuota, accrued: a.accrued, catchUp: a.catchUp, nextRunAt: r.nextRunAt }; })
    .filter((i) => i.accrued > 0);
  const periodicAccrued = round2(periodicItems.reduce((s, i) => s + i.accrued, 0));

  const available = round2(bal.balance - taxPending - goalsParked - committed.total - periodicAccrued - loansOutstanding);
  const status = available < 0 ? "NEGATIVE" : fixedMonthly > 0 && available < fixedMonthly * 0.2 ? "LOW" : "OK";

  const breakdown = [
    { key: "balance", label: "Saldo effettivo", amount: bal.balance, sign: 1 },
    { key: "taxPending", label: "Tasse accantonate da trasferire", amount: taxPending, sign: -1 },
    { key: "goalsParked", label: "Parcheggiati negli obiettivi", amount: goalsParked, sign: -1 },
    { key: "committed", label: "Uscite fisse entro fine mese", amount: committed.total, sign: -1 },
  ];
  if (periodicAccrued > 0) {
    breakdown.push({ key: "periodic", label: "Accantonato per spese periodiche", amount: periodicAccrued, sign: -1 });
  }
  if (loansOutstanding > 0) {
    breakdown.push({ key: "loans", label: "Prestiti interni da rientrare", amount: loansOutstanding, sign: -1 });
  }

  return {
    today,
    hasOpeningBalance: bal.hasOpeningBalance,
    openingBalance: household.openingBalance,
    openingBalanceDate: household.openingBalanceDate,
    accounts: bal.accounts,
    balance: bal.balance,
    taxPending,
    goalsParked,
    committedUntilMonthEnd: committed.total,
    committedItems: committed.items,
    periodicAccrued,
    periodicItems,
    loansOutstanding,
    fixedMonthly,
    available,
    status,
    breakdown,
  };
}
