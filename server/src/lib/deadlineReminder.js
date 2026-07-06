// Promemoria scadenze fiscali: email + push per-utente a 30, 7 e 1 giorno
// dalla scadenza. Anti-duplicato stateless: il cron gira una volta al giorno e
// si invia solo quando i giorni mancanti coincidono esattamente con uno stage.
import { prisma } from "./prisma.js";
import { sendEmail } from "./email.js";
import { sendPushToUser } from "./push.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const STAGES = new Set([30, 7, 1]);

const eur = (n) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n || 0);

/** Mezzanotte UTC del giorno corrente calcolato nel fuso Europe/Rome. */
function todayRomeUTC() {
  const str = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
  const [y, m, d] = str.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Invia i promemoria all'utente per le scadenze che oggi distano esattamente
 * 30/7/1 giorni. Con force=true invia comunque per la prossima scadenza futura
 * (per i test manuali).
 */
export async function sendDeadlineRemindersForUser(userId, { force = false } = {}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });
  if (!user) throw new Error("Utente non trovato");

  const today = todayRomeUTC();
  const deadlines = await prisma.taxDeadline.findMany({
    where: { userId, paid: false, dueDate: { gte: today } },
    orderBy: { dueDate: "asc" },
  });

  const sent = [];
  let skipped = 0;

  for (const d of deadlines) {
    const daysUntil = Math.round((new Date(d.dueDate).getTime() - today.getTime()) / MS_PER_DAY);
    const isStage = STAGES.has(daysUntil);
    // force: invia per la sola prossima scadenza anche fuori dagli stage.
    const shouldSend = isStage || (force && sent.length === 0);
    if (!shouldSend) {
      skipped++;
      continue;
    }

    const when = daysUntil === 0 ? "oggi" : daysUntil === 1 ? "domani" : `tra ${daysUntil} giorni`;
    const subject = `CasaWallet — Scadenza ${d.name} ${when}: ${eur(d.expectedAmount)}`;
    const html = `
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color:#b3701a;">Scadenza fiscale in arrivo</h2>
        <p>Ciao ${user.name}, la scadenza <strong>${d.name}</strong> (${d.type}) è ${when}:
        <strong>${eur(d.expectedAmount)}</strong> previsti per il
        ${new Date(d.dueDate).toLocaleDateString("it-IT")}.</p>
        <p style="color:#64748b;font-size:14px;">
          Controlla in CasaWallet se il fondo tasse copre l'importo.
        </p>
      </div>`;

    await sendEmail({ to: [user.email], subject, html });
    const push = await sendPushToUser(userId, {
      title: "Scadenza fiscale",
      body: `${d.name} ${when}: ${eur(d.expectedAmount)}`,
      url: "/treasury",
    });

    console.log(`[deadlineReminder] ${user.email}: ${d.name} ${when}, push:`, push);
    sent.push({ id: d.id, name: d.name, daysUntil, forced: !isStage });
  }

  return { userId, email: user.email, sent, skipped };
}

/** Corsa giornaliera su tutti gli utenti (il cron la chiama alle 08:00). */
export async function sendDeadlineReminders({ force = false } = {}) {
  const users = await prisma.user.findMany({ select: { id: true } });
  const results = [];
  for (const u of users) {
    try {
      results.push(await sendDeadlineRemindersForUser(u.id, { force }));
    } catch (err) {
      console.error(`[deadlineReminder] fallito per ${u.id}:`, err.message);
      results.push({ userId: u.id, error: err.message });
    }
  }
  return results;
}
