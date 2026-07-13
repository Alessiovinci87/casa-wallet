// Alert "spesa insolita": quando il totale del mese corrente di una categoria
// supera 1.5× la media storica (ultimi 6 mesi pieni con dati, minimo 3) E la
// soglia viene attraversata proprio dalla transazione appena creata, si invia
// una push alla famiglia. Il check dell'attraversamento evita alert ripetuti:
// le transazioni successive partono già sopra soglia e non notificano di nuovo.
import { prisma } from "./prisma.js";
import { sendPushToHousehold } from "./push.js";

const MIN_MONTHS_HISTORY = 3;
const THRESHOLD_MULTIPLIER = 1.5;
const MIN_ALERT_AMOUNT = 50; // niente alert per categorie da pochi euro

/**
 * Da chiamare (senza await) dopo la creazione di una transazione EXPENSE.
 * Qualsiasi errore viene solo loggato: mai bloccare la risposta all'utente.
 */
export async function checkUnusualSpend({ householdId, category, amount, date }) {
  try {
    const when = new Date(date);
    const monthStart = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth() + 1, 1));
    const historyStart = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth() - 6, 1));

    const [currentAgg, history] = await Promise.all([
      prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { householdId, category, type: "EXPENSE", date: { gte: monthStart, lt: nextMonth } },
      }),
      prisma.transaction.findMany({
        where: { householdId, category, type: "EXPENSE", date: { gte: historyStart, lt: monthStart } },
        select: { amount: true, date: true },
      }),
    ]);

    // Media sui mesi passati che hanno almeno una spesa nella categoria.
    const byMonth = new Map();
    for (const t of history) {
      const key = `${t.date.getUTCFullYear()}-${t.date.getUTCMonth()}`;
      byMonth.set(key, (byMonth.get(key) || 0) + t.amount);
    }
    if (byMonth.size < MIN_MONTHS_HISTORY) return;

    const avg = [...byMonth.values()].reduce((s, v) => s + v, 0) / byMonth.size;
    const threshold = Math.max(avg * THRESHOLD_MULTIPLIER, MIN_ALERT_AMOUNT);

    const monthTotal = currentAgg._sum.amount || 0;
    const beforeThisTx = monthTotal - amount;
    if (monthTotal <= threshold || beforeThisTx > threshold) return; // niente attraversamento

    const pct = Math.round(((monthTotal - avg) / avg) * 100);
    await sendPushToHousehold(householdId, {
      title: `Spesa insolita: ${category}`,
      body: `Questo mese ${monthTotal.toFixed(0)}€, +${pct}% sopra la media (${avg.toFixed(0)}€/mese).`,
      url: "/budgets",
    });
    console.log(`[spend-alert] ${category}: ${monthTotal.toFixed(2)} > soglia ${threshold.toFixed(2)}`);
  } catch (err) {
    console.error("[spend-alert] check fallito:", err.message);
  }
}
