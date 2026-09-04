// Piano di rientro di un prestito dal fondo tasse: rate mensili nei mesi PIENI
// tra il prelievo e la scadenza fiscale (settembre → ottobre e novembre = 2 rate),
// nel giorno del mese del prelievo, mai oltre la scadenza. Minimo una rata.
const round2 = (n) => Number((Math.round(n * 100) / 100).toFixed(2));

function utcDay(d) {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

export function computeInstallmentPlan({ amount, takenAt, dueDate }) {
  const start = utcDay(takenAt);
  const due = utcDay(dueDate);
  const total = round2(Number(amount) || 0);
  const monthsGap = (due.getUTCFullYear() - start.getUTCFullYear()) * 12 + (due.getUTCMonth() - start.getUTCMonth());
  const count = Math.max(1, monthsGap);
  const dates = [];
  for (let k = 1; k <= count; k++) {
    const y = start.getUTCFullYear();
    const m = start.getUTCMonth() + k;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    let d = new Date(Date.UTC(y, m, Math.min(start.getUTCDate(), lastDay)));
    if (d > due) d = due;
    dates.push(d);
  }
  if (monthsGap < 1) dates[0] = due; // stessa mensilità: tutto entro la scadenza
  const base = round2(total / count);
  const installments = dates.map((date, i) => ({
    date,
    amount: i === count - 1 ? round2(total - base * (count - 1)) : base,
  }));
  return { count, installment: base, installments, dueDate: due };
}

/** Rate ancora da pagare dato quanto è già rientrato (le prime si considerano coperte). */
export function remainingInstallments(plan, repaid) {
  let covered = Number(repaid) || 0;
  const out = [];
  for (const it of plan.installments) {
    if (covered >= it.amount - 0.005) { covered = round2(covered - it.amount); continue; }
    const amount = round2(it.amount - Math.max(0, covered));
    covered = 0;
    if (amount > 0) out.push({ ...it, amount });
  }
  return out;
}
