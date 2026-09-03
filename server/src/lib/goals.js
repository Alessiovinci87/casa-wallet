// Obiettivi di risparmio: matematica deterministica (nessuna AI).
//   saved         = Σ contributi (versamenti − prelievi)
//   monthlyQuota  = (target − saved) / mesi rimanenti  (SINKING collegato: da regola)
//   status        = ON_TRACK | BEHIND | AHEAD | DONE vs traiettoria lineare
//   projectedDate = al ritmo medio dei versamenti degli ultimi 3 mesi
//   proposeAllocation = riparto di un importo per priorità (SINKING → GOAL → BUFFER)
import { prisma } from "./prisma.js";
import { monthlyEquivalent } from "./recurrence.js";

export const GOAL_KINDS = new Set(["GOAL", "SINKING", "BUFFER"]);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MONTH = 30.4375 * MS_PER_DAY;

const round2 = (n) => Number((Math.round(n * 100) / 100).toFixed(2));

/** Mesi (frazionari, min 1) tra due date. Null se `to` manca. */
function monthsBetween(from, to) {
  if (!to) return null;
  const diff = (new Date(to).getTime() - new Date(from).getTime()) / MS_PER_MONTH;
  return Math.max(1, Math.ceil(diff - 1e-9));
}

function utcMonthStart(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Arricchisce un obiettivo con i numeri derivati. `goal.contributions` e
 * `goal.linkedRecurringRule` devono essere già caricati.
 */
export function enrichGoal(goal, today = new Date()) {
  const contributions = goal.contributions || [];
  const rule = goal.linkedRecurringRule || null;
  const saved = round2(contributions.reduce((s, c) => s + c.amount, 0));

  // SINKING collegato: target e scadenza vengono dalla regola.
  const target = rule && goal.kind === "SINKING" ? Number(rule.amount) : Number(goal.targetAmount);
  const dueDate = rule && goal.kind === "SINKING" ? rule.nextRunAt : goal.targetDate;

  const remaining = Math.max(0, round2(target - saved));
  const monthsRemaining = dueDate ? monthsBetween(today, dueDate) : null;

  // Quota mensile: SINKING collegato = quota costante della regola (amount/mesi);
  // se al ritmo della quota non si arriva alla scadenza, `shortfall` dice quanto
  // manca e `catchUpQuota` la quota che servirebbe. GOAL/SINKING con data:
  // residuo / mesi rimanenti. BUFFER: nessuna quota (senza data).
  let monthlyQuota = null;
  let shortfall = 0;
  let catchUpQuota = null;
  if (rule && goal.kind === "SINKING") {
    monthlyQuota = remaining === 0 ? 0 : monthlyEquivalent(rule);
    if (monthsRemaining && remaining > 0) {
      shortfall = round2(Math.max(0, remaining - monthlyQuota * monthsRemaining));
      catchUpQuota = shortfall > 0 ? round2(remaining / monthsRemaining) : null;
    }
  } else if (monthsRemaining) {
    monthlyQuota = round2(remaining / monthsRemaining);
  }

  // Traiettoria lineare per mesi da startDate a dueDate. Il mese corrente è
  // una fascia di tolleranza: BEHIND se sotto la quota dei mesi già chiusi,
  // AHEAD se sopra quella dei mesi chiusi + corrente.
  let status = "ON_TRACK";
  if (target > 0 && saved >= target) status = "DONE";
  else if (dueDate) {
    const start = new Date(goal.startDate || goal.createdAt);
    const totalMonths = monthsBetween(start, dueDate);
    const elapsedMonths = Math.min(totalMonths, monthsBetween(start, today));
    const quotaPerMonth = target / totalMonths;
    const tolerance = Math.max(1, target * 0.02);
    if (saved < quotaPerMonth * (elapsedMonths - 1) - tolerance) status = "BEHIND";
    else if (saved > quotaPerMonth * elapsedMonths + tolerance) status = "AHEAD";
  }

  // Ritmo: versamenti (positivi) degli ultimi 90 giorni / 3.
  const since = new Date(today.getTime() - 90 * MS_PER_DAY);
  const recent = contributions
    .filter((c) => c.amount > 0 && new Date(c.date) >= since)
    .reduce((s, c) => s + c.amount, 0);
  const paceMonthly = round2(recent / 3);
  let projectedDate = null;
  if (remaining === 0) projectedDate = today;
  else if (paceMonthly > 0) {
    projectedDate = new Date(today.getTime() + (remaining / paceMonthly) * MS_PER_MONTH);
  }

  // Versato questo mese (solo positivi) e quota residua del mese.
  const monthStart = utcMonthStart(today);
  const monthContributed = round2(
    contributions.filter((c) => c.amount > 0 && new Date(c.date) >= monthStart).reduce((s, c) => s + c.amount, 0)
  );
  const monthRemaining = monthlyQuota == null ? null : round2(Math.max(0, monthlyQuota - monthContributed));

  return {
    ...goal,
    contributions: undefined,
    contributionCount: contributions.length,
    lastContributionAt: contributions.length
      ? contributions.reduce((m, c) => (new Date(c.date) > m ? new Date(c.date) : m), new Date(0))
      : null,
    saved,
    target: round2(target),
    remaining,
    dueDate,
    monthsRemaining,
    monthlyQuota,
    shortfall,
    catchUpQuota,
    monthContributed,
    monthRemaining,
    paceMonthly,
    projectedDate,
    status,
    progress: target > 0 ? Math.min(1, saved / target) : 0,
  };
}

const goalInclude = {
  contributions: { select: { amount: true, date: true } },
  linkedRecurringRule: { select: { id: true, amount: true, frequency: true, interval: true, nextRunAt: true, description: true } },
  user: { select: { id: true, name: true } },
};

/** Obiettivi visibili all'utente: condivisi della famiglia + i suoi personali. */
export async function listGoals({ householdId, userId, includeInactive = false }) {
  const where = {
    householdId,
    OR: [{ personal: false }, { personal: true, userId }],
  };
  if (!includeInactive) where.active = true;
  const goals = await prisma.savingsGoal.findMany({
    where,
    include: goalInclude,
    orderBy: [{ active: "desc" }, { priority: "asc" }, { targetDate: "asc" }, { createdAt: "asc" }],
  });
  return goals.map((g) => enrichGoal(g));
}

/** Un obiettivo per id (con ownership: famiglia + visibilità personale). */
export async function findGoal({ id, householdId, userId }) {
  const goal = await prisma.savingsGoal.findFirst({
    where: { id, householdId, OR: [{ personal: false }, { personal: true, userId }] },
    include: goalInclude,
  });
  return goal ? enrichGoal(goal) : null;
}

/** Riepilogo per la Dashboard. */
export function summarizeGoals(goals) {
  const active = goals.filter((g) => g.active);
  return {
    count: active.length,
    parked: round2(active.reduce((s, g) => s + Math.max(0, g.saved), 0)),
    monthQuota: round2(active.reduce((s, g) => s + (g.monthlyQuota || 0), 0)),
    monthContributed: round2(active.reduce((s, g) => s + g.monthContributed, 0)),
    behind: active.filter((g) => g.status === "BEHIND").length,
  };
}

const KIND_ORDER = { SINKING: 0, GOAL: 1, BUFFER: 2 };

/**
 * Proposta di riparto di `amount` sugli obiettivi attivi: prima le quote
 * residue del mese dei SINKING (scadenza più vicina), poi GOAL (priorità,
 * data), poi BUFFER. Il resto va ai BUFFER fino al target, poi resta
 * "unallocated". Nessuna scrittura.
 */
export function proposeAllocation(goals, amount) {
  const candidates = goals
    .filter((g) => g.active && g.status !== "DONE" && g.remaining > 0)
    .sort((a, b) => {
      const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
      if (k) return k;
      if (a.kind === "SINKING") return (a.dueDate ? +new Date(a.dueDate) : Infinity) - (b.dueDate ? +new Date(b.dueDate) : Infinity);
      if (a.priority !== b.priority) return a.priority - b.priority;
      return (a.dueDate ? +new Date(a.dueDate) : Infinity) - (b.dueDate ? +new Date(b.dueDate) : Infinity);
    });

  let left = round2(amount);
  const alloc = new Map();
  // Passata 1: quota residua del mese (o tutto il residuo se manca la quota).
  for (const g of candidates) {
    if (left <= 0) break;
    const want = g.monthRemaining != null ? g.monthRemaining : 0;
    const give = round2(Math.min(left, want, g.remaining));
    if (give > 0) {
      alloc.set(g.id, give);
      left = round2(left - give);
    }
  }
  // Passata 2: il resto ai BUFFER (poi GOAL) fino al target.
  for (const g of [...candidates].sort((a, b) => (b.kind === "BUFFER") - (a.kind === "BUFFER"))) {
    if (left <= 0) break;
    const already = alloc.get(g.id) || 0;
    const give = round2(Math.min(left, g.remaining - already));
    if (give > 0) {
      alloc.set(g.id, round2(already + give));
      left = round2(left - give);
    }
  }

  return {
    amount: round2(amount),
    allocations: candidates
      .filter((g) => alloc.has(g.id))
      .map((g) => ({
        goalId: g.id,
        name: g.name,
        kind: g.kind,
        icon: g.icon,
        amount: alloc.get(g.id),
        monthRemainingBefore: g.monthRemaining,
        remainingBefore: g.remaining,
      })),
    unallocated: left,
  };
}
