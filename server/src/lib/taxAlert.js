// Monthly "salvadanaio tasse" reminder. Il salvadanaio è PERSONALE: ogni
// utente riceve email + push con il SOLO proprio totale non trasferito.
import { prisma } from "./prisma.js";
import { sendEmail } from "./email.js";
import { sendPushToUser } from "./push.js";

const eur = (n) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n || 0);

/**
 * Compute one user's pending tax total and notify them by email + push.
 * @param {string} userId
 * @param {{ force?: boolean }} [opts] force=true sends even when the total is 0.
 * @returns {Promise<{ userId: string, email: string, totalPending: number, sent: boolean }>}
 */
export async function sendTaxAlertForUser(userId, { force = false } = {}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });
  if (!user) throw new Error("Utente non trovato");

  const pending = await prisma.taxSaving.findMany({
    where: { transferred: false, transaction: { userId } },
  });
  const totalPending = pending.reduce((sum, t) => sum + t.amount, 0);

  if (totalPending <= 0 && !force) {
    return { userId, email: user.email, totalPending, sent: false };
  }

  const subject = `CasaWallet — Tasse da accantonare: ${eur(totalPending)}`;
  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#059669;">Promemoria salvadanaio tasse</h2>
      <p>Ciao ${user.name}, al momento risultano <strong>${eur(totalPending)}</strong>
      accantonati per le tue tasse e non ancora trasferiti sul conto dedicato.</p>
      <p style="color:#64748b;font-size:14px;">
        Ricordati di effettuare il bonifico e segnare gli importi come trasferiti in CasaWallet.
      </p>
    </div>`;

  await sendEmail({ to: [user.email], subject, html });
  const push = await sendPushToUser(userId, {
    title: "Promemoria tasse",
    body: `${eur(totalPending)} accantonati da trasferire`,
    url: "/tax-savings",
  });

  console.log(`[taxAlert] ${user.email}: ${eur(totalPending)}, push:`, push);
  return { userId, email: user.email, totalPending, sent: true, push };
}

/**
 * Run the monthly reminder for every user (each gets their own figure).
 * @param {{ force?: boolean }} [opts]
 */
export async function sendTaxAlerts({ force = false } = {}) {
  const users = await prisma.user.findMany({ select: { id: true } });
  const results = [];
  for (const u of users) {
    try {
      results.push(await sendTaxAlertForUser(u.id, { force }));
    } catch (err) {
      console.error(`[taxAlert] fallito per ${u.id}:`, err.message);
      results.push({ userId: u.id, error: err.message });
    }
  }
  return results;
}
