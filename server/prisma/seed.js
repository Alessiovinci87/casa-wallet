// CasaWallet — seed the 2 fixed users (no public registration).
// Passwords are read from env so real credentials never live in git.
//   SEED_USER1_EMAIL / SEED_USER1_NAME / SEED_USER1_PASSWORD
//   SEED_USER2_EMAIL / SEED_USER2_NAME / SEED_USER2_PASSWORD

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHouseholdWithUniqueCode } from "../src/lib/inviteCode.js";
import { firstOccurrenceOnOrAfter, todayRomeUTC } from "../src/lib/recurrence.js";

const prisma = new PrismaClient();

const users = [
  {
    email: process.env.SEED_USER1_EMAIL || "alessio@casawallet.local",
    name: process.env.SEED_USER1_NAME || "Alessio",
    password: process.env.SEED_USER1_PASSWORD || "changeme",
    role: "OWNER",
  },
  {
    email: process.env.SEED_USER2_EMAIL || "moglie@casawallet.local",
    name: process.env.SEED_USER2_NAME || "Moglie",
    password: process.env.SEED_USER2_PASSWORD || "changeme",
    role: "MEMBER",
  },
];

async function main() {
  // Una sola famiglia seed, idempotente: riusa "Casa" se esiste già.
  let household = await prisma.household.findFirst({ where: { name: "Casa" } });
  if (!household) {
    household = await createHouseholdWithUniqueCode(prisma, "Casa");
    console.log(`seeded household: ${household.name} (invite ${household.inviteCode})`);
  }

  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    // I due account storici sono considerati verificati (niente banner).
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, passwordHash, householdId: household.id, role: u.role, emailVerifiedAt: new Date() },
      create: {
        email: u.email,
        name: u.name,
        passwordHash,
        householdId: household.id,
        role: u.role,
        emailVerifiedAt: new Date(),
      },
    });
    console.log(`seeded user: ${u.email} (${u.role})`);
  }

  // Ricorrenze della famiglia reale (dati di test, sez. 4 del brief). Idempotenti
  // per (household, description): il cron le posta quando arrivano a scadenza.
  // Solo in dev (SEED_DEMO_RULES=1) per non sporcare la prod al deploy.
  if (process.env.SEED_DEMO_RULES === "1") {
    const owner = await prisma.user.findUnique({ where: { email: users[0].email } });
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
      console.log(`seeded recurring rule: ${r.description}`);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
