// Previsione cash-flow a N giorni (deterministica). Parte dal "libero oggi"
// (saldo effettivo − tasse accantonate − obiettivi − prestiti) e applica giorno
// per giorno:
//   − occorrenze ricorrenti future (uscite) / + (entrate)          [F1]
//   − scadenze fiscali non pagate di tutti i membri, al netto della parte
//     coperta dal fondo tasse (consumato in ordine di scadenza)
//   + incassi attesi (fatture EMESSE, netto post-accantonamento)     [treasury]
//   − quote obiettivi del mese (il 1° di ogni mese; oggi per il residuo corrente) [F3]
//   − rate di rientro dei prestiti dal fondo tasse (rialimentano il fondo)   [F6]
// Ritorna i giorni con saldo proiettato e flag NEGATIVE / LOW (< 20% delle fisse).
import { prisma } from "./prisma.js";
import { occurrencesBetween, todayRomeUTC } from "./recurrence.js";
import { computeExpectedCollections } from "./treasury.js";
import { computeAvailable } from "./available.js";
import { listGoals } from "./goals.js";
import { enrichLoan } from "./loans.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const round2 = (n) => Number((Math.round(n * 100) / 100).toFixed(2));
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

export async function buildForecast({ householdId, userId, days = 90 }) {
  const today = todayRomeUTC();
  const horizon = new Date(today.getTime() + days * MS_PER_DAY);

  const [avail, rules, members, goals] = await Promise.all([
    computeAvailable({ householdId, userId }),
    prisma.recurringRule.findMany({ where: { householdId, active: true } }),
    prisma.user.findMany({ where: { householdId }, select: { id: true, name: true } }),
    listGoals({ householdId, userId }),
  ]);

  const events = [];

  // 1) Ricorrenze (da domani: oggi il cron ha già postato) + occorrenze in attesa.
  const tomorrow = new Date(today.getTime() + MS_PER_DAY);
  for (const rule of rules) {
    const sign = rule.type === "INCOME" ? 1 : -1;
    const label = rule.description || rule.category;
    if (rule.pendingAt) {
      events.push({ date: rule.pendingAt < today ? today : rule.pendingAt, kind: "recurring", label: `${label} (da confermare)`, amount: sign * rule.amount, ruleId: rule.id });
    }
    const from = new Date(Math.max(tomorrow.getTime(), rule.nextRunAt ? rule.nextRunAt.getTime() : 0));
    if (from > horizon) continue;
    for (const date of occurrencesBetween(rule, from, horizon)) {
      events.push({ date, kind: "recurring", label, amount: sign * rule.amount, ruleId: rule.id });
    }
  }

  // 2) Rate di rientro dei prestiti interni (future, non ancora coperte da quanto già rientrato).
  const memberIds = members.map((m) => m.id);
  const nameOf = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const loans = await prisma.internalLoan.findMany({ where: { userId: { in: memberIds }, status: { in: ["OPEN", "LATE"] } } });
  const loanEvents = [];
  for (const l of loans) {
    for (const it of enrichLoan(l, today).remainingInstallments) {
      const date = it.date < today ? today : it.date;
      if (date > horizon) continue;
      loanEvents.push({ date, kind: "loan", label: `Rata rientro fondo tasse · ${nameOf[l.userId] || ""}`.trim(), amount: -it.amount, loanId: l.id });
    }
  }
  loanEvents.sort((a, b) => a.date - b.date);
  events.push(...loanEvents);

  // 3) Scadenze fiscali non pagate (tutti i membri), coperte dal fondo tasse in
  //    ordine. Il fondo parte al netto dei prestiti aperti e si rialimenta con
  //    le rate che precedono ogni scadenza.
  const deadlines = await prisma.taxDeadline.findMany({
    where: { userId: { in: memberIds }, paid: false, dueDate: { lte: horizon } },
    orderBy: { dueDate: "asc" },
  });
  let fund = round2(avail.taxPending - (avail.loansOutstanding || 0));
  let li = 0;
  for (const d of deadlines) {
    const due = d.dueDate < today ? today : d.dueDate;
    while (li < loanEvents.length && loanEvents[li].date <= due) { fund = round2(fund - loanEvents[li].amount); li += 1; }
    const covered = Math.max(0, Math.min(fund, d.expectedAmount));
    fund = round2(fund - covered);
    const uncovered = round2(d.expectedAmount - covered);
    events.push({
      date: d.dueDate < today ? today : d.dueDate,
      kind: "deadline",
      label: `${d.name} · ${nameOf[d.userId] || ""}`.trim(),
      amount: -uncovered,
      gross: d.expectedAmount,
      coveredByFund: round2(covered),
      deadlineId: d.id,
      overdue: d.dueDate < today,
    });
  }

  // 4) Incassi attesi (netto post-accantonamento), per ogni membro con fatture.
  for (const m of members) {
    const coll = await computeExpectedCollections({ userId: m.id, todayUTC: today });
    if (!coll) continue;
    for (const it of coll.items) {
      if (it.expectedAt > horizon) continue;
      events.push({ date: it.expectedAt, kind: "collection", label: `Incasso fattura · ${m.name}`, amount: round2(it.net), estimated: true });
    }
  }

  // 5) Quote obiettivi: residuo del mese corrente oggi, quota piena il 1° dei mesi successivi.
  const active = goals.filter((g) => g.active && g.status !== "DONE");
  const monthRemaining = round2(active.reduce((s, g) => s + (g.monthRemaining || 0), 0));
  const monthQuota = round2(active.reduce((s, g) => s + (g.monthlyQuota || 0), 0));
  if (monthRemaining > 0) events.push({ date: today, kind: "goal", label: "Quote obiettivi (resto del mese)", amount: -monthRemaining });
  if (monthQuota > 0) {
    for (let k = 1; k < 12; k++) {
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + k, 1));
      if (first > horizon) break;
      events.push({ date: first, kind: "goal", label: "Quote obiettivi del mese", amount: -monthQuota });
    }
  }

  // Aggregazione per giorno + saldo proiettato.
  const startBalance = round2(avail.available + avail.committedUntilMonthEnd + (avail.periodicAccrued || 0)); // il libero oggi, prima delle fisse
  const byDay = new Map();
  for (const e of events) {
    const k = dayKey(e.date);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }
  const threshold = round2(avail.fixedMonthly * 0.2);
  const daily = [];
  let balance = startBalance;
  let minBalance = startBalance;
  let minDate = today;
  let firstNegative = null;
  for (let i = 0; i <= days; i++) {
    const date = new Date(today.getTime() + i * MS_PER_DAY);
    const k = dayKey(date);
    const evs = byDay.get(k) || [];
    const delta = round2(evs.reduce((s, e) => s + e.amount, 0));
    balance = round2(balance + delta);
    const flag = balance < 0 ? "NEGATIVE" : threshold > 0 && balance < threshold ? "LOW" : null;
    if (balance < minBalance) { minBalance = balance; minDate = date; }
    if (flag === "NEGATIVE" && !firstNegative) firstNegative = date;
    daily.push({ date, delta, balance, flag, events: evs.length ? evs : undefined });
  }

  events.sort((a, b) => a.date - b.date);
  return {
    today,
    days,
    horizon,
    startBalance,
    threshold,
    endBalance: balance,
    minBalance,
    minDate,
    firstNegative,
    daysNegative: daily.filter((d) => d.flag === "NEGATIVE").length,
    daysLow: daily.filter((d) => d.flag === "LOW").length,
    totals: {
      recurringOut: round2(events.filter((e) => e.kind === "recurring" && e.amount < 0).reduce((s, e) => s + e.amount, 0)),
      recurringIn: round2(events.filter((e) => e.kind === "recurring" && e.amount > 0).reduce((s, e) => s + e.amount, 0)),
      deadlines: round2(events.filter((e) => e.kind === "deadline").reduce((s, e) => s + e.amount, 0)),
      collections: round2(events.filter((e) => e.kind === "collection").reduce((s, e) => s + e.amount, 0)),
      goals: round2(events.filter((e) => e.kind === "goal").reduce((s, e) => s + e.amount, 0)),
      loans: round2(events.filter((e) => e.kind === "loan").reduce((s, e) => s + e.amount, 0)),
    },
    events,
    daily,
    disclaimer: "Proiezione deterministica: ricorrenze, scadenze, incassi attesi, quote obiettivi e rate dei prestiti dal fondo tasse. Le spese variabili non sono incluse.",
  };
}
