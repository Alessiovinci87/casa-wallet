// Salvadanaio tasse PERSONALE. Un accantonamento appartiene all'utente se è
// legato a una sua entrata (transaction.userId) oppure, per il "già accantonato"
// del punto zero, se ha userId diretto e nessuna transazione.
import { prisma } from "./prisma.js";

export const OPENING_NOTE = "saldo iniziale";
const round2 = (n) => Number((Math.round(n * 100) / 100).toFixed(2));

/** Filtro Prisma: accantonamenti dell'utente. */
export const ownTaxSavingWhere = (userId) => ({ OR: [{ userId }, { transaction: { userId } }] });
/** Filtro Prisma: accantonamenti di tutti i membri della famiglia. */
export const householdTaxSavingWhere = (householdId) => ({ OR: [{ user: { householdId } }, { transaction: { householdId } }] });

/** Fondo tasse non ancora trasferito dell'utente. */
export async function pendingTaxFund(userId) {
  const agg = await prisma.taxSaving.aggregate({ where: { transferred: false, ...ownTaxSavingWhere(userId) }, _sum: { amount: true } });
  return round2(agg._sum.amount || 0);
}

/** Record "già accantonato per le tasse" dell'utente (uno solo, senza transazione). */
export function findOpeningTaxSaving(userId) {
  return prisma.taxSaving.findFirst({ where: { userId, transactionId: null, note: OPENING_NOTE } });
}

/**
 * Imposta (o azzera con null/0) il fondo tasse iniziale: crea/aggiorna il
 * TaxSaving personale senza transazione, pending, note "saldo iniziale".
 * Reversibile: con null il record sparisce.
 */
export async function setOpeningTaxSaving(userId, amount, date = new Date()) {
  const existing = await findOpeningTaxSaving(userId);
  const n = amount == null ? null : Number(amount);
  if (n != null && (!Number.isFinite(n) || n < 0)) throw new Error("amount deve essere ≥ 0");
  if (n == null || n === 0) {
    if (existing) await prisma.taxSaving.delete({ where: { id: existing.id } });
    return null;
  }
  const data = { amount: round2(n), month: date.getUTCMonth() + 1, year: date.getUTCFullYear() };
  if (existing) return prisma.taxSaving.update({ where: { id: existing.id }, data: { amount: data.amount } });
  return prisma.taxSaving.create({ data: { userId, note: OPENING_NOTE, transferred: false, ...data } });
}
