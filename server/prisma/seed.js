// CasaWallet — seed the 2 fixed users (no public registration).
// Passwords are read from env so real credentials never live in git.
//   SEED_USER1_EMAIL / SEED_USER1_NAME / SEED_USER1_PASSWORD
//   SEED_USER2_EMAIL / SEED_USER2_NAME / SEED_USER2_PASSWORD

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHouseholdWithUniqueCode } from "../src/lib/inviteCode.js";

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
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, passwordHash, householdId: household.id, role: u.role },
      create: {
        email: u.email,
        name: u.name,
        passwordHash,
        householdId: household.id,
        role: u.role,
      },
    });
    console.log(`seeded user: ${u.email} (${u.role})`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
