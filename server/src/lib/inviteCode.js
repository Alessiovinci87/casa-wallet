// Codice invito famiglia: 8 caratteri da un alfabeto senza simboli ambigui
// (niente 0/O, 1/I/L) così si può dettare a voce o scrivere su WhatsApp.

import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export function generateInviteCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}

/**
 * Crea una Household con un inviteCode univoco, ritentando in caso di
 * collisione (P2002). Con 32^8 combinazioni le collisioni sono teoriche,
 * ma il retry costa poco.
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {string} name
 */
export async function createHouseholdWithUniqueCode(db, name) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.household.create({
        data: { name, inviteCode: generateInviteCode() },
      });
    } catch (err) {
      if (err?.code === "P2002") continue; // inviteCode già esistente: riprova
      throw err;
    }
  }
  throw new Error("Impossibile generare un codice invito univoco");
}
