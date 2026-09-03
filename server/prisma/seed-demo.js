// Dati DEMO per guida utente e prove locali — MAI eseguito dal Dockerfile.
// Crea la famiglia "Demo" (2 membri con nomi neutri, password `demo1234`) con:
// saldo iniziale, 4 ricorrenze (auto, internet, acqua, mutuo semestrale),
// 3 obiettivi (cuscinetto, spesa periodica del mutuo, vacanze con data),
// entrate con % tasse e uscite degli ultimi 6 mesi, 2 scontrini con prodotti,
// budget Spesa, una scadenza fiscale futura, una fattura in attesa.
// Idempotente: se la famiglia "Demo" esiste già viene ricreata da zero.
// Uso: DATABASE_URL="file:./guide.db" node prisma/seed-demo.js
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHouseholdWithUniqueCode } from "../src/lib/inviteCode.js";
import { firstOccurrenceOnOrAfter, todayRomeUTC } from "../src/lib/recurrence.js";

const prisma = new PrismaClient();
export const DEMO = {
  household: "Demo",
  owner: { email: "anna@demo.local", name: "Anna", password: "demo1234" },
  member: { email: "marco@demo.local", name: "Marco", password: "demo1234" },
};

const today = todayRomeUTC();
const utc = (y, m0, d) => new Date(Date.UTC(y, m0, d));
const monthsAgo = (n, day) => {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - n, 1));
  return utc(d.getUTCFullYear(), d.getUTCMonth(), Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
};
const monthsAhead = (n, day) => monthsAgo(-n, day);

async function wipeDemo() {
  const hh = await prisma.household.findFirst({ where: { name: DEMO.household }, include: { users: true } });
  if (!hh) return;
  const userIds = hh.users.map((u) => u.id);
  await prisma.$transaction([
    prisma.goalContribution.deleteMany({ where: { goal: { householdId: hh.id } } }),
    prisma.savingsGoal.deleteMany({ where: { householdId: hh.id } }),
    prisma.internalLoan.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.invoice.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.taxDeadline.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.fiscalProfile.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.receiptItem.deleteMany({ where: { receipt: { householdId: hh.id } } }),
    prisma.receipt.deleteMany({ where: { householdId: hh.id } }),
    prisma.taxSaving.deleteMany({ where: { transaction: { householdId: hh.id } } }),
    prisma.transaction.deleteMany({ where: { householdId: hh.id } }),
    prisma.recurringRule.deleteMany({ where: { householdId: hh.id } }),
    prisma.categoryBudget.deleteMany({ where: { householdId: hh.id } }),
    prisma.categoryRule.deleteMany({ where: { householdId: hh.id } }),
    prisma.pushSubscription.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
    prisma.household.delete({ where: { id: hh.id } }),
  ]);
}

async function main() {
  await wipeDemo();
  const household = await createHouseholdWithUniqueCode(prisma, DEMO.household);
  await prisma.household.update({
    where: { id: household.id },
    data: { openingBalance: 3200, openingBalanceDate: monthsAgo(6, 1) },
  });
  const [anna, marco] = await Promise.all(
    [DEMO.owner, DEMO.member].map(async (u, i) =>
      prisma.user.create({
        data: {
          email: u.email,
          name: u.name,
          passwordHash: await bcrypt.hash(u.password, 10),
          householdId: household.id,
          role: i === 0 ? "OWNER" : "MEMBER",
          emailVerifiedAt: new Date(),
        },
      })
    )
  );

  // Profilo fiscale di Anna (P.IVA forfettaria) + scadenza futura
  await prisma.fiscalProfile.create({
    data: { userId: anna.id, regime: "FORFETTARIO", partitaIva: "01234567890", coeffRedditivita: 0.78, aliquotaImposta: 15, aliquotaInps: 26.23, defaultTaxPercent: 30 },
  });
  await prisma.taxDeadline.create({
    data: { userId: anna.id, name: "Secondo acconto", type: "IRPEF_ACCONTO", dueDate: utc(today.getUTCFullYear(), 10, 30) > today ? utc(today.getUTCFullYear(), 10, 30) : utc(today.getUTCFullYear() + 1, 5, 30), expectedAmount: 2400 },
  });

  // Ricorrenze
  const rulesDef = [
    { type: "EXPENSE", amount: 289, category: "Trasporti", method: "TRANSFER", description: "Rata auto", frequency: "MONTHLY", dayOfMonth: 5, startDate: monthsAgo(6, 5), endDate: monthsAhead(18, 5) },
    { type: "EXPENSE", amount: 29.9, category: "Bollette", method: "CARD", description: "Internet casa", frequency: "MONTHLY", dayOfMonth: 14, startDate: monthsAgo(6, 14) },
    { type: "EXPENSE", amount: 48, category: "Bollette", method: "CARD", description: "Acqua", frequency: "MONTHLY", dayOfMonth: 31, startDate: monthsAgo(6, 28) },
    { type: "EXPENSE", amount: 1800, category: "Casa", method: "TRANSFER", description: "Mutuo semestrale", frequency: "SEMIANNUAL", dayOfMonth: 21, startDate: monthsAgo(3, 21) },
  ];
  const rules = {};
  for (const r of rulesDef) {
    // Le occorrenze passate esistono come transazioni collegate; la prossima è futura.
    const rule = await prisma.recurringRule.create({ data: { ...r, userId: anna.id, householdId: household.id, nextRunAt: firstOccurrenceOnOrAfter(r, new Date(today.getTime() + 864e5)), lastPostedAt: today } });
    rules[r.description] = rule;
    if (r.frequency === "MONTHLY") {
      for (let k = 6; k >= 0; k--) {
        const d = monthsAgo(k, r.dayOfMonth);
        if (d > today) continue;
        await prisma.transaction.create({ data: { userId: anna.id, householdId: household.id, amount: r.amount, type: "EXPENSE", category: r.category, method: r.method, description: r.description, date: d, recurringRuleId: rule.id } });
      }
    } else {
      await prisma.transaction.create({ data: { userId: anna.id, householdId: household.id, amount: r.amount, type: "EXPENSE", category: r.category, method: r.method, description: r.description, date: monthsAgo(3, 21), recurringRuleId: rule.id } });
    }
  }

  // Entrate: Marco stipendio 2.450 il 27 (senza tasse), Anna fatture con 30% accantonato
  for (let k = 6; k >= 1; k--) {
    await prisma.transaction.create({ data: { userId: marco.id, householdId: household.id, amount: 2450, type: "INCOME", category: "Stipendio", method: "TRANSFER", description: "Stipendio", date: monthsAgo(k, 27) } });
    const gross = [1650, 1280, 2100, 1400, 1900, 1750][k - 1];
    const when = monthsAgo(k, 12);
    await prisma.transaction.create({
      data: {
        userId: anna.id, householdId: household.id, amount: gross, type: "INCOME", category: "Fatture", method: "TRANSFER", description: `Incasso fattura ${7 - k}`, date: when,
        taxPercent: 30, taxAmount: Number((gross * 0.3).toFixed(2)),
        taxSaving: { create: { amount: Number((gross * 0.3).toFixed(2)), month: when.getUTCMonth() + 1, year: when.getUTCFullYear(), transferred: k >= 4, transferredAt: k >= 4 ? when : null } },
      },
    });
  }

  // Uscite variabili (spesa, ristorante, svago, salute) ultimi 6 mesi
  const variable = [
    ["Spesa", 62.4, 3], ["Spesa", 48.9, 10], ["Spesa", 71.2, 17], ["Spesa", 55, 24],
    ["Ristorante", 44, 8], ["Svago", 25, 15], ["Salute", 18.5, 20], ["Abbigliamento", 79.9, 22],
  ];
  for (let k = 6; k >= 0; k--) {
    for (const [cat, amt, day] of variable) {
      const d = monthsAgo(k, day);
      if (d > today) continue;
      await prisma.transaction.create({ data: { userId: k % 2 ? marco.id : anna.id, householdId: household.id, amount: Number((amt * (1 + ((k * 7 + day) % 5) / 40)).toFixed(2)), type: "EXPENSE", category: cat, method: "POS", description: cat === "Spesa" ? "Supermercato" : null, date: d } });
    }
  }

  // Scontrini con prodotti (due negozi: serve a "Dove conviene comprare" e alla lista spesa)
  const items = (store, factor) => [
    { rawName: "LATTE PS 1L", canonicalName: "latte", category: "Latticini e uova", quantity: 2, unitPrice: 1.19 * factor, totalPrice: 2.38 * factor },
    { rawName: "PANE CASERECCIO", canonicalName: "pane", category: "Pane e cereali", quantity: 1, unitPrice: 2.6 * factor, totalPrice: 2.6 * factor },
    { rawName: "BANANE", canonicalName: "banane", category: "Frutta e verdura", quantity: 1, unitPrice: 1.89 * factor, totalPrice: 1.89 * factor },
    { rawName: "PETTO POLLO", canonicalName: "petto di pollo", category: "Carne e pesce", quantity: 1, unitPrice: 6.9 * factor, totalPrice: 6.9 * factor },
    { rawName: "DETERSIVO PIATTI", canonicalName: "detersivo piatti", category: "Cura casa", quantity: 1, unitPrice: 2.3 * factor, totalPrice: 2.3 * factor },
  ].map((it) => ({ ...it, unitPrice: Number(it.unitPrice.toFixed(2)), totalPrice: Number(it.totalPrice.toFixed(2)), store }));
  const receipts = [
    ["Supermercato Nord", 1, [5, 3], [4, 10], [3, 3], [2, 10], [1, 3], [0, 3]],
    ["Discount Sud", 0.86, [4, 24], [2, 24], [1, 24]],
  ];
  for (const [store, factor, ...dates] of receipts) {
    for (const [k, day] of dates) {
      const d = monthsAgo(k, day);
      if (d > today) continue;
      const its = items(store, factor).map((it) => ({ ...it, date: d }));
      await prisma.receipt.create({ data: { userId: anna.id, householdId: household.id, store, total: Number(its.reduce((s, i) => s + i.totalPrice, 0).toFixed(2)), date: d, items: { create: its } } });
    }
  }

  // Budget e lista spesa
  await prisma.categoryBudget.create({ data: { householdId: household.id, category: "Spesa", amount: 450 } });
  await prisma.recurringProduct.create({ data: { householdId: household.id, canonicalName: "latte", alwaysBuy: true } });

  // Obiettivi: cuscinetto, spesa periodica (mutuo), vacanze con data
  const buffer = await prisma.savingsGoal.create({ data: { householdId: household.id, userId: anna.id, name: "Cuscinetto emergenze", icon: "🛡️", kind: "BUFFER", targetAmount: 3000, priority: 3, startDate: monthsAgo(5, 1) } });
  const sinking = await prisma.savingsGoal.create({ data: { householdId: household.id, userId: anna.id, name: "Mutuo semestrale", icon: "🏠", kind: "SINKING", targetAmount: 1800, priority: 1, linkedRecurringRuleId: rules["Mutuo semestrale"].id, startDate: monthsAgo(3, 21) } });
  const vac = await prisma.savingsGoal.create({ data: { householdId: household.id, userId: marco.id, name: "Vacanze", icon: "🏖️", kind: "GOAL", targetAmount: 2500, targetDate: monthsAhead(10, 1), priority: 2, startDate: monthsAgo(2, 1) } });
  const contrib = [
    [buffer, 5, 400], [buffer, 4, 400], [buffer, 3, 300], [buffer, 2, 300], [buffer, 1, 250],
    [sinking, 2, 300], [sinking, 1, 300], [sinking, 0, 300],
    [vac, 2, 210], [vac, 1, 210], [vac, 0, 210],
  ];
  for (const [g, k, amt] of contrib) {
    const d = monthsAgo(k, 28);
    if (d > today) continue;
    await prisma.goalContribution.create({ data: { goalId: g.id, userId: anna.id, amount: amt, date: d, note: "Distribuisci" } });
  }

  // Fattura in attesa di incasso (Anna)
  await prisma.invoice.create({
    data: {
      userId: anna.id, source: "XML", filename: "IT01234567890_00007.xml", numero: "7", year: today.getUTCFullYear(), date: new Date(today.getTime() - 12 * 864e5), tipoDocumento: "TD01",
      customerName: "Studio Rossi Srl", customerVat: "09876543210", imponibile: 1500, iva: 0, ritenuta: 0, cassa: 60, bollo: 2, grossTotal: 1562, netToPay: 1562, dueDate: new Date(today.getTime() + 18 * 864e5), status: "EMESSA",
    },
  });

  console.log(`demo: famiglia "${DEMO.household}" (invito ${household.inviteCode}) — ${DEMO.owner.email} / ${DEMO.member.email}, password ${DEMO.owner.password}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
