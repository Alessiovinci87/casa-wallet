// Dati demo SOLO per il dev locale (mai eseguito dal Dockerfile): le 4 ricorrenze
// della famiglia reale (brief "Consapevolezza & Obiettivi", sez. 4). Idempotente
// per (famiglia "Casa", description). Uso: node prisma/seed-demo.js (dopo seed.js).
import { PrismaClient } from "@prisma/client";
import { firstOccurrenceOnOrAfter, todayRomeUTC } from "../src/lib/recurrence.js";

const prisma = new PrismaClient();

async function main() {
  const household = await prisma.household.findFirst({ where: { name: "Casa" } });
  if (!household) throw new Error("Famiglia 'Casa' assente: esegui prima node prisma/seed.js");
  const owner = await prisma.user.findFirst({ where: { householdId: household.id, role: "OWNER" } });

  const rules = [
    { type: "EXPENSE", amount: 326.29, category: "Trasporti", method: "TRANSFER", description: "Rata auto", frequency: "MONTHLY", dayOfMonth: 5, startDate: new Date(Date.UTC(2026, 8, 1)), endDate: new Date(Date.UTC(2027, 3, 5)) },
    { type: "EXPENSE", amount: 66.67, category: "Bollette", method: "CARD", description: "Internet", frequency: "MONTHLY", dayOfMonth: 14, startDate: new Date(Date.UTC(2026, 8, 1)) },
    { type: "EXPENSE", amount: 65, category: "Bollette", method: "CARD", description: "Aquamea", frequency: "MONTHLY", dayOfMonth: 31, startDate: new Date(Date.UTC(2026, 8, 1)) },
    { type: "EXPENSE", amount: 2100, category: "Casa", method: "TRANSFER", description: "Mutuo", frequency: "SEMIANNUAL", dayOfMonth: 21, startDate: new Date(Date.UTC(2026, 5, 21)) },
  ];
  for (const r of rules) {
    const exists = await prisma.recurringRule.findFirst({ where: { householdId: household.id, description: r.description } });
    if (exists) continue;
    const nextRunAt = firstOccurrenceOnOrAfter(r, todayRomeUTC());
    await prisma.recurringRule.create({ data: { ...r, nextRunAt, userId: owner.id, householdId: household.id } });
    console.log(`demo rule: ${r.description}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
