// Monthly "salvadanaio tasse" reminder: emails both users the total amount of
// tax savings set aside but not yet transferred. Shared piggy bank (the
// TaxSaving table is not per-user), so every user gets the same figure.
import { prisma } from "./prisma.js";
import { sendEmail } from "./email.js";
import { sendPushToAll } from "./push.js";

const eur = (n) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n || 0);

/**
 * Compute the pending tax total and notify both users by email.
 * @param {{ force?: boolean }} [opts] force=true sends even when the total is 0.
 * @returns {Promise<{ totalPending: number, recipients: string[], sent: boolean }>}
 */
export async function sendTaxAlert({ force = false } = {}) {
  const pending = await prisma.taxSaving.findMany({ where: { transferred: false } });
  const totalPending = pending.reduce((sum, t) => sum + t.amount, 0);

  const users = await prisma.user.findMany({ select: { email: true, name: true } });
  const recipients = users.map((u) => u.email);

  if (totalPending <= 0 && !force) {
    console.log("[taxAlert] nessun importo pendente, email non inviata");
    return { totalPending, recipients, sent: false };
  }

  const subject = `CasaWallet — Tasse da accantonare: ${eur(totalPending)}`;
  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#059669;">Promemoria salvadanaio tasse</h2>
      <p>Al momento risultano <strong>${eur(totalPending)}</strong> accantonati per le tasse
      e non ancora trasferiti sul conto dedicato.</p>
      <p style="color:#64748b;font-size:14px;">
        Ricordati di effettuare il bonifico e segnare gli importi come trasferiti in CasaWallet.
      </p>
    </div>`;

  await sendEmail({ to: recipients, subject, html });
  // Same event also goes out as a Web Push notification to every device.
  const push = await sendPushToAll({
    title: "Promemoria tasse",
    body: `${eur(totalPending)} accantonati da trasferire`,
    url: "/tax-savings",
  });

  console.log(`[taxAlert] email a ${recipients.length} utenti, push:`, push, `totale ${eur(totalPending)}`);
  return { totalPending, recipients, sent: true, push };
}
