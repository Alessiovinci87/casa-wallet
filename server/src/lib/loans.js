// Prestiti interni dal fondo tasse (PERSONALI). Guardrail non aggirabili:
//   - si crea solo se simulateSelfFinancing dà OK
//   - amount ≤ maxSelfFinancePercent × fondo (default 50%), al netto dei prestiti già aperti
//   - dueDate = prossima TaxDeadline non pagata (obbligatoria)
// Stato LATE se il rientro sfora la traiettoria lineare; reminder rata mensile
// (giorno del prelievo) e alert forte a 30 giorni dalla scadenza se repaid < amount.
import { prisma } from "./prisma.js";
import { simulateSelfFinancing } from "./treasury.js";
import { sendEmail } from "./email.js";
import { sendPushToUser } from "./push.js";
import { todayRomeUTC } from "./recurrence.js";
import { computeInstallmentPlan, remainingInstallments } from "./repaymentPlan.js";

export const DEFAULT_MAX_PERCENT = 50;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const round2 = (n) => Number((Math.round(n * 100) / 100).toFixed(2));
const eur = (n) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n || 0);

/** Traiettoria del piano: somma delle rate con data ≤ oggi (LATE se sotto). */
export function expectedRepaidByNow(loan, today = new Date()) {
  const plan = computeInstallmentPlan({ amount: loan.amount, takenAt: loan.takenAt, dueDate: loan.dueDate });
  return round2(plan.installments.filter((i) => i.date <= today).reduce((s, i) => s + i.amount, 0));
}

export function enrichLoan(loan, today = new Date()) {
  const outstanding = round2(Math.max(0, loan.amount - loan.repaid));
  const expected = expectedRepaidByNow(loan, today);
  const daysToDue = Math.round((new Date(loan.dueDate).getTime() - today.getTime()) / MS_PER_DAY);
  const monthsLeft = Math.max(0, Math.ceil(daysToDue / 30.4375));
  const plan = computeInstallmentPlan({ amount: loan.amount, takenAt: loan.takenAt, dueDate: loan.dueDate });
  const remaining = remainingInstallments(plan, loan.repaid);
  return {
    ...loan,
    outstanding,
    installments: plan.installments,
    installmentsCount: plan.count,
    remainingInstallments: remaining,
    nextInstallment: remaining[0] || null,
    expectedRepaidByNow: expected,
    behindBy: round2(Math.max(0, expected - loan.repaid)),
    progress: loan.amount > 0 ? Math.min(1, loan.repaid / loan.amount) : 1,
    daysToDue,
    // Rata suggerita per chiudere in tempo (≥ quella pattuita se in ritardo).
    suggestedRepayment: monthsLeft > 0 ? round2(Math.max(loan.monthlyRepayment, outstanding / monthsLeft)) : outstanding,
  };
}

/** Riepilogo per Tesoreria/Dashboard: quanto del fondo è prestato. */
export async function loansSummary(userId) {
  const loans = await prisma.internalLoan.findMany({ where: { userId, status: { in: ["OPEN", "LATE"] } } });
  const outstanding = round2(loans.reduce((s, l) => s + Math.max(0, l.amount - l.repaid), 0));
  return { openCount: loans.length, outstanding };
}

/**
 * Crea un prestito interno applicando i guardrail. Ritorna { loan } oppure
 * { error, code, simulation } (400 lato route).
 */
export async function createInternalLoan({ userId, householdId, amount, note, scope = "user", force = false }) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return { error: "amount deve essere > 0", code: "AMOUNT" };

  const simulation = await simulateSelfFinancing({ userId, householdId, amount: n, scope });
  if (!simulation.ok) return { error: "Dati insufficienti per simulare il rientro", code: simulation.reason, simulation };
  // Verdetto: OK → si crea; RISCHIO → solo con conferma esplicita (force, loggata);
  // NO → mai.
  if (simulation.overallVerdict === "NO") {
    const why = simulation.missing?.length ? ` Manca: ${simulation.missing.join("; ")}.` : "";
    return { error: `Verdetto NO (${simulation.basisLabel}): il rientro non ci sta entro la scadenza, prestito rifiutato.${why}`, code: "VERDICT", simulation };
  }
  if (simulation.overallVerdict === "RISCHIO" && !force) {
    return { error: `Verdetto RISCHIO (${simulation.basisLabel}): il rientro potrebbe sforare la scadenza. Puoi procedere solo confermando l'avviso.`, code: "VERDICT_RISK", simulation };
  }
  if (!simulation.nextDeadline) {
    return { error: "Nessuna scadenza fiscale futura: aggiungila prima di prelevare dal fondo", code: "NO_DEADLINE", simulation };
  }

  const [profile, open] = await Promise.all([
    prisma.fiscalProfile.findUnique({ where: { userId }, select: { maxSelfFinancePercent: true } }),
    loansSummary(userId),
  ]);
  const maxPercent = profile?.maxSelfFinancePercent ?? DEFAULT_MAX_PERCENT;
  const cap = round2((simulation.fundAvailable * maxPercent) / 100 - open.outstanding);
  if (n > cap + 0.005) {
    return {
      error: `Puoi prelevare al massimo ${eur(Math.max(0, cap))} (${maxPercent}% del fondo${open.outstanding > 0 ? ", al netto dei prestiti aperti" : ""})`,
      code: "CAP",
      simulation,
      cap: Math.max(0, cap),
      maxPercent,
    };
  }

  const today = todayRomeUTC();
  const dueDate = new Date(simulation.nextDeadline.dueDate);
  // Rata = importo ÷ mesi pieni fino alla scadenza (vedi repaymentPlan.js).
  const plan = computeInstallmentPlan({ amount: n, takenAt: today, dueDate });
  const monthlyRepayment = plan.installment;

  const loan = await prisma.internalLoan.create({
    data: {
      userId,
      amount: n,
      takenAt: today,
      dueDate,
      deadlineId: simulation.nextDeadline.id,
      monthlyRepayment,
      note: note ? String(note).trim() : null,
      simulationVerdict: simulation.overallVerdict,
      forced: simulation.overallVerdict === "RISCHIO" && Boolean(force),
    },
  });
  return { loan: enrichLoan(loan), simulation, cap, maxPercent, fundAfter: round2(simulation.fundAvailable - open.outstanding - n) };
}

/**
 * Corsa giornaliera: aggiorna LATE/OPEN, manda il promemoria rata nel giorno
 * del mese del prelievo e l'alert forte a 30 giorni dalla scadenza.
 */
export async function checkInternalLoans({ force = false } = {}) {
  const today = todayRomeUTC();
  const loans = await prisma.internalLoan.findMany({
    where: { status: { in: ["OPEN", "LATE"] } },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  const results = [];
  for (const loan of loans) {
    const e = enrichLoan(loan, today);
    const tolerance = Math.max(1, loan.amount * 0.02);
    const nextStatus = loan.repaid < e.expectedRepaidByNow - tolerance ? "LATE" : "OPEN";
    if (nextStatus !== loan.status) {
      await prisma.internalLoan.update({ where: { id: loan.id }, data: { status: nextStatus } });
    }

    const takenDay = new Date(loan.takenAt).getUTCDate();
    const isRateDay = today.getUTCDate() === takenDay && today > new Date(loan.takenAt);
    const strong = e.daysToDue === 30 && loan.repaid < loan.amount;
    if (!(force || isRateDay || strong)) {
      results.push({ id: loan.id, status: nextStatus, sent: false });
      continue;
    }

    const subject = strong
      ? `Awareness — Prestito interno: mancano ${eur(e.outstanding)} a 30 giorni dalla scadenza`
      : `Awareness — Rata prestito interno: ${eur(e.suggestedRepayment)}`;
    const body = strong
      ? `Tra 30 giorni scade ${eur(loan.amount)} presa dal fondo tasse: rientrati ${eur(loan.repaid)}, mancano ${eur(e.outstanding)}.`
      : `Rata di rientro suggerita ${eur(e.suggestedRepayment)} (mancano ${eur(e.outstanding)} entro il ${new Date(loan.dueDate).toLocaleDateString("it-IT")}).`;
    try {
      await sendEmail({
        to: [loan.user.email],
        subject,
        html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto"><h2 style="color:#b3701a">Prestito dal fondo tasse</h2><p>Ciao ${loan.user.name}, ${body}</p></div>`,
      });
      await sendPushToUser(loan.userId, { title: strong ? "Prestito interno: 30 giorni" : "Rata prestito interno", body, url: "/treasury" });
      await prisma.internalLoan.update({ where: { id: loan.id }, data: { lastAlertAt: today } });
    } catch (err) {
      console.error("[loans] alert fallito:", err.message);
    }
    results.push({ id: loan.id, status: nextStatus, sent: true, strong });
  }
  return { today, checked: loans.length, results };
}
