// Consulente: legge entrate, spese fisse e variabili, obiettivi, e produce un
// resoconto in italiano con verdetti e proposte concrete. Deterministico (niente
// AI): ogni numero è ricostruibile. Con poco storico le stime si appoggiano
// alle ricorrenze e lo dice esplicitamente.
import { prisma } from "./prisma.js";
import { monthlyEquivalent, todayRomeUTC } from "./recurrence.js";
import { listGoals } from "./goals.js";

const round2 = (n) => Number((Math.round(n * 100) / 100).toFixed(2));
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTHS_IT = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const fmt = (n) => `${Number(n).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fmtDate = (d) => `${d.getUTCDate()} ${MONTHS_IT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

// Categorie difficili da tagliare: le proposte di risparmio partono dalle altre.
const ESSENTIAL = new Set(["Casa", "Bollette", "Salute", "Tasse", "Spesa"]);
// Quanto proporre di tagliare, per categoria (frazione della spesa media mensile).
const CUT_SHARE = { Ristorante: 0.4, Svago: 0.4, Abbigliamento: 0.5, Altro: 0.3, Trasporti: 0.15, Spesa: 0.1 };

function monthKey(d) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }
function addMonths(d, n) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, Math.min(d.getUTCDate(), 28))); }

/**
 * @param {{ householdId: string, userId: string, months?: number }} p
 * @returns {Promise<object>} report
 */
export async function buildAdvisorReport({ householdId, userId, months = 3 }) {
  const today = todayRomeUTC();
  const M = Math.min(12, Math.max(1, Number(months) || 3));
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (M - 1), 1));
  const [txs, rules, goals] = await Promise.all([
    prisma.transaction.findMany({
      where: { householdId, date: { gte: from, lte: new Date(today.getTime() + MS_PER_DAY - 1) } },
      select: { amount: true, type: true, category: true, merchant: true, what: true, date: true, recurringRuleId: true },
    }),
    prisma.recurringRule.findMany({ where: { householdId, active: true } }),
    listGoals({ householdId, userId }),
  ]);

  // --- Storico per mese
  const byMonth = new Map();
  for (const t of txs) {
    const k = monthKey(t.date);
    const m = byMonth.get(k) || { income: 0, expense: 0, fixed: 0, variable: 0, n: 0 };
    m.n += 1;
    if (t.type === "INCOME") m.income += t.amount;
    else { m.expense += t.amount; if (t.recurringRuleId) m.fixed += t.amount; else m.variable += t.amount; }
    byMonth.set(k, m);
  }
  const observedMonths = [...byMonth.keys()].sort();
  // Il mese corrente è parziale: pesa per la frazione di giorni trascorsi.
  const daysInMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
  const currentKey = monthKey(today);
  // Nei primi giorni del mese non si estrapola (3 giorni × 10 sarebbero numeri finti).
  const monthWeight = (k) => (k === currentKey ? (today.getUTCDate() < 10 ? 1 : Math.max(0.5, today.getUTCDate() / daysInMonth)) : 1);
  const weightSum = observedMonths.reduce((s, k) => s + monthWeight(k), 0) || 1;
  const avg = (field) => round2(observedMonths.reduce((s, k) => s + byMonth.get(k)[field], 0) / weightSum);
  const avgIncomeHist = avg("income");
  const avgVariableHist = avg("variable");
  const shortHistory = weightSum < 2; // meno di ~2 mesi pieni

  // --- Ricorrenze: base prevedibile
  const fixedRules = rules.filter((r) => r.type === "EXPENSE");
  const incomeRules = rules.filter((r) => r.type === "INCOME");
  const fixedMonthly = round2(fixedRules.reduce((s, r) => s + monthlyEquivalent(r), 0));
  const incomeRulesMonthly = round2(incomeRules.reduce((s, r) => s + monthlyEquivalent(r), 0));
  // Entrate attese: le ricorrenti sono la base; lo storico (se c'è) alza la stima se maggiore.
  const expectedIncome = round2(Math.max(incomeRulesMonthly, shortHistory ? 0 : avgIncomeHist));
  const incomeSource = expectedIncome === incomeRulesMonthly && incomeRulesMonthly > 0 ? "ricorrenze" : expectedIncome > 0 ? "storico" : "nessuna";
  const variableMonthly = avgVariableHist;
  const free = round2(expectedIncome - fixedMonthly - variableMonthly);

  // --- Obiettivi
  const activeGoals = goals.filter((g) => g.active && g.status !== "DONE");
  const goalsQuota = round2(activeGoals.reduce((s, g) => s + (g.catchUpQuota ?? g.monthlyQuota ?? 0), 0));
  const margin = round2(free - goalsQuota);

  // --- Spese variabili per voce ("Cosa" → "Dove" → categoria), media mensile
  const buckets = new Map();
  for (const t of txs) {
    if (t.type !== "EXPENSE" || t.recurringRuleId) continue;
    const label = t.what || t.merchant || t.category;
    const key = `${t.category}|${String(label).toLowerCase()}`;
    const b = buckets.get(key) || { label, category: t.category, total: 0, count: 0 };
    b.total += t.amount; b.count += 1;
    buckets.set(key, b);
  }
  const bucketList = [...buckets.values()].map((b) => ({ ...b, total: round2(b.total), monthly: round2(b.total / weightSum) })).sort((a, b) => b.monthly - a.monthly);

  // Proposte di taglio: voci non essenziali, dalla più pesante; risparmio = quota × spesa media.
  const cuts = [];
  for (const b of bucketList) {
    if (b.monthly < 10) continue;
    const share = CUT_SHARE[b.category] ?? (ESSENTIAL.has(b.category) ? 0.1 : 0.3);
    const saving = round2(b.monthly * share);
    if (saving < 5) continue;
    cuts.push({ label: b.label, category: b.category, monthly: b.monthly, count: b.count, share, saving, essential: ESSENTIAL.has(b.category) });
    if (cuts.length >= 8) break;
  }
  const cutsTotal = round2(cuts.reduce((s, c) => s + c.saving, 0));
  // Ricorrenze piccole "da abbonamento": sommate valgono più di quanto sembri.
  const smallSubs = fixedRules.filter((r) => monthlyEquivalent(r) <= 30 && !["Casa", "Bollette", "Tasse"].includes(r.category)).map((r) => ({ description: r.description || r.category, monthly: monthlyEquivalent(r), category: r.category }));
  const smallSubsTotal = round2(smallSubs.reduce((s, r) => s + r.monthly, 0));

  // --- Verdetti per obiettivo
  const goalVerdicts = activeGoals.map((g) => {
    const quota = g.catchUpQuota ?? g.monthlyQuota ?? 0;
    const remaining = g.remaining;
    let verdict, text;
    const options = [];
    if (!quota) {
      verdict = "OK"; text = "Senza scadenza: si alimenta quando avanza qualcosa.";
    } else if (quota <= Math.max(0, free) * 0.6 || margin >= 0) {
      verdict = "OK"; text = `Servono ${fmt(quota)} al mese: entrano nel margine libero di ${fmt(Math.max(0, free))}.`;
    } else if (free > 0) {
      verdict = "TIGHT";
      const monthsNeeded = Math.ceil(remaining / Math.max(1, free * 0.6));
      const altDate = addMonths(today, monthsNeeded);
      text = `Servono ${fmt(quota)} al mese ma il margine libero è ${fmt(free)}: tutto il margine finirebbe qui.`;
      options.push({ kind: "postpone", text: `Sposta la data al ${fmtDate(altDate)}: basterebbero ${fmt(round2(remaining / monthsNeeded))} al mese.`, date: altDate });
      if (cutsTotal > 0) options.push({ kind: "cut", text: `Con i tagli proposti sotto liberi ${fmt(cutsTotal)} al mese: ${cutsTotal >= quota - free * 0.6 ? "la quota diventa sostenibile" : "copri una parte della quota"}.`, saving: cutsTotal });
      options.push({ kind: "income", text: `Oppure servono ${fmt(round2(quota - free * 0.6))} al mese di entrate in più (un incasso extra ogni tanto basta).` });
    } else {
      verdict = "NO";
      text = `Oggi non c'è margine: fisse e variabili superano le entrate${shortHistory ? " (stima su poco storico)" : ""}. La quota di ${fmt(quota)} al mese non è sostenibile così.`;
      if (cutsTotal > 0) options.push({ kind: "cut", text: `Primo passo: i tagli proposti valgono ${fmt(cutsTotal)} al mese.`, saving: cutsTotal });
      const monthsNeeded = Math.ceil(remaining / Math.max(50, cutsTotal));
      options.push({ kind: "postpone", text: `Con quel risparmio ci arrivi in circa ${monthsNeeded} mesi (${fmtDate(addMonths(today, monthsNeeded))}).`, date: addMonths(today, monthsNeeded) });
    }
    // Quota del mese saltata?
    const dayOfMonth = today.getUTCDate();
    const missed = quota > 0 && dayOfMonth >= 20 && g.monthContributed < quota * 0.5;
    const behind = g.status === "BEHIND";
    return {
      id: g.id, name: g.name, icon: g.icon, kind: g.kind, target: g.target, saved: g.saved, remaining, dueDate: g.dueDate,
      monthsRemaining: g.monthsRemaining, quota: round2(quota), monthContributed: g.monthContributed, status: g.status,
      verdict, text, options,
      alerts: [
        ...(missed ? [`Quota di ${MONTHS_IT[today.getUTCMonth()]} non versata: mancano ${fmt(round2(quota - g.monthContributed))}.`] : []),
        ...(behind && g.shortfall > 0 ? [`Sei indietro di ${fmt(g.shortfall)} rispetto al piano: per recuperare servono ${fmt(g.catchUpQuota)} al mese invece di ${fmt(g.monthlyQuota)}.`] : behind ? ["Sei sotto la traiettoria prevista: versa qualcosa in più questo mese."] : []),
      ],
    };
  });

  // --- Messaggi
  const messages = [];
  if (shortHistory) messages.push({ level: "info", title: "Storico breve", text: `Ho ${observedMonths.length === 0 ? "nessun" : "meno di due"} mes${observedMonths.length === 1 ? "e" : "i"} di movimenti: uso le ricorrenze come base. Importa gli estratti degli ultimi mesi (Altro → Importa estratto conto) e il resoconto diventa affidabile.` });
  if (expectedIncome === 0) messages.push({ level: "bad", title: "Nessuna entrata prevedibile", text: "Non ci sono entrate ricorrenti né storico: aggiungi lo stipendio o le entrate fisse come ricorrenza (Movimenti → Ricorrenze → Entrata)." });
  if (expectedIncome > 0 && fixedMonthly > expectedIncome * 0.6) messages.push({ level: "warn", title: "Fisse pesanti", text: `Le spese fisse (${fmt(fixedMonthly)}) sono il ${Math.round((fixedMonthly / expectedIncome) * 100)}% delle entrate: sopra il 60% ogni imprevisto pesa. Guarda le ricorrenze e chiediti quali servono davvero.` });
  if (smallSubsTotal >= 20) messages.push({ level: "info", title: "Abbonamenti", text: `${smallSubs.length} ricorrenze piccole (${smallSubs.map((s) => s.description).slice(0, 5).join(", ")}${smallSubs.length > 5 ? "…" : ""}) valgono ${fmt(smallSubsTotal)} al mese, ${fmt(round2(smallSubsTotal * 12))} l'anno.` });
  if (free < 0) messages.push({ level: "bad", title: "Esce più di quanto entra", text: `Ogni mese mancano circa ${fmt(-free)} tra fisse e variabili. Prima di qualsiasi obiettivo va chiuso questo buco.` });
  else if (goalsQuota > 0 && margin < 0) messages.push({ level: "warn", title: "Obiettivi sopra le possibilità", text: `Le quote degli obiettivi (${fmt(goalsQuota)}) superano il margine libero (${fmt(free)}) di ${fmt(-margin)} al mese. Sotto trovi come rientrare.` });
  else if (goalsQuota > 0) messages.push({ level: "ok", title: "Obiettivi sostenibili", text: `Dopo fisse, variabili e quote degli obiettivi restano ${fmt(margin)} al mese. Se avanza, la cosa più utile è versarli sull'obiettivo con la data più vicina.` });
  if (cuts.length) messages.push({ level: "info", title: "Dove si può tagliare", text: `Le voci variabili più pesanti sono ${cuts.slice(0, 3).map((c) => `${c.label} (${fmt(c.monthly)}/mese)`).join(", ")}. Riducendole come proposto risparmi ${fmt(cutsTotal)} al mese, ${fmt(round2(cutsTotal * 12))} l'anno.` });

  const periodLabel = `${MONTHS_IT[from.getUTCMonth()]} ${from.getUTCFullYear()} – ${MONTHS_IT[today.getUTCMonth()]} ${today.getUTCFullYear()}`;
  const report = {
    generatedAt: today, period: { from, to: today, months: M, label: periodLabel, observedMonths, shortHistory },
    capacity: { expectedIncome, incomeSource, incomeRulesMonthly, avgIncomeHist, fixedMonthly, variableMonthly, free, goalsQuota, margin },
    monthly: observedMonths.map((k) => ({ month: k, ...byMonth.get(k), income: round2(byMonth.get(k).income), expense: round2(byMonth.get(k).expense), fixed: round2(byMonth.get(k).fixed), variable: round2(byMonth.get(k).variable) })),
    goals: goalVerdicts,
    cuts, cutsTotal,
    smallSubs, smallSubsTotal,
    topBuckets: bucketList.slice(0, 10),
    messages,
  };
  report.text = reportToText(report);
  return report;
}

/** Versione testuale (Markdown) del resoconto: copia/condividi/stampa, o da dare a un assistente. */
export function reportToText(r) {
  const c = r.capacity;
  const lines = [];
  lines.push(`# Resoconto Awareness · ${r.period.label}`);
  lines.push("");
  lines.push("## Capacità mensile");
  lines.push(`- Entrate attese: ${fmt(c.expectedIncome)} (base: ${c.incomeSource})`);
  lines.push(`- Spese fisse (ricorrenze): ${fmt(c.fixedMonthly)}`);
  lines.push(`- Spese variabili (media): ${fmt(c.variableMonthly)}`);
  lines.push(`- Margine libero: ${fmt(c.free)}`);
  lines.push(`- Quote obiettivi: ${fmt(c.goalsQuota)} → dopo gli obiettivi: ${fmt(c.margin)}`);
  if (r.period.shortHistory) lines.push(`- Nota: storico breve (${r.period.observedMonths.length} mesi), stime basate sulle ricorrenze.`);
  lines.push("");
  if (r.monthly.length) {
    lines.push("## Mesi osservati");
    for (const m of r.monthly) lines.push(`- ${m.month}: entrate ${fmt(m.income)}, uscite ${fmt(m.expense)} (fisse ${fmt(m.fixed)}, variabili ${fmt(m.variable)})`);
    lines.push("");
  }
  lines.push("## Obiettivi");
  if (!r.goals.length) lines.push("- Nessun obiettivo attivo.");
  for (const g of r.goals) {
    lines.push(`- ${g.name}: ${fmt(g.saved)} su ${fmt(g.target)}${g.dueDate ? `, scadenza ${fmtDate(new Date(g.dueDate))}` : ""} → ${g.verdict === "OK" ? "sostenibile" : g.verdict === "TIGHT" ? "difficile" : "non sostenibile ora"}. ${g.text}`);
    for (const o of g.options) lines.push(`  - ${o.text}`);
    for (const a of g.alerts) lines.push(`  - ⚠ ${a}`);
  }
  lines.push("");
  lines.push("## Spese variabili principali (media mensile)");
  for (const b of r.topBuckets) lines.push(`- ${b.label} (${b.category}): ${fmt(b.monthly)}/mese, ${b.count} volte`);
  lines.push("");
  lines.push("## Tagli proposti");
  if (!r.cuts.length) lines.push("- Niente da proporre: poche spese variabili registrate.");
  for (const k of r.cuts) lines.push(`- ${k.label}: da ${fmt(k.monthly)} a ${fmt(round2(k.monthly - k.saving))} al mese (−${Math.round(k.share * 100)}%) → risparmio ${fmt(k.saving)}`);
  if (r.cuts.length) lines.push(`- Totale: ${fmt(r.cutsTotal)} al mese, ${fmt(round2(r.cutsTotal * 12))} l'anno`);
  if (r.smallSubs.length) lines.push(`- Abbonamenti piccoli: ${r.smallSubs.map((s) => `${s.description} ${fmt(s.monthly)}`).join(", ")} = ${fmt(r.smallSubsTotal)}/mese`);
  lines.push("");
  lines.push("## Messaggi");
  for (const m of r.messages) lines.push(`- [${m.level}] ${m.title}: ${m.text}`);
  return lines.join("\n");
}

/** Notifica trimestrale (push + email) a tutta la famiglia con il link al Consulente. */
export async function sendQuarterlyReports({ sendPushToHousehold, sendEmail, force = false } = {}) {
  const today = todayRomeUTC();
  const q = Math.floor(today.getUTCMonth() / 3) + 1;
  const households = await prisma.household.findMany({ include: { users: { select: { id: true, email: true, name: true } } } });
  let sent = 0;
  for (const hh of households) {
    const owner = hh.users[0];
    if (!owner) continue;
    const report = await buildAdvisorReport({ householdId: hh.id, userId: owner.id, months: 3 });
    if (!force && report.period.observedMonths.length === 0) continue;
    const c = report.capacity;
    const body = `Trimestre ${q}: margine ${fmt(c.margin)}/mese${report.cutsTotal > 0 ? `, possibili risparmi ${fmt(report.cutsTotal)}/mese` : ""}. Apri il Consulente.`;
    try { await sendPushToHousehold?.(hh.id, { title: "Resoconto trimestrale pronto", body, url: "/advisor" }); } catch (err) { console.error("[advisor] push fallita", err); }
    for (const u of hh.users) {
      if (!u.email) continue;
      try {
        await sendEmail?.({ to: u.email, subject: `Awareness · resoconto trimestrale (${report.period.label})`, html: `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(report.text)}</pre>` });
      } catch (err) { console.error("[advisor] email fallita", err); }
    }
    sent += 1;
  }
  return { households: sent };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));
}
