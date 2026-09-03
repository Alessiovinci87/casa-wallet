// Gestione famiglia: info + membri, rename, rigenerazione codice invito.
// Rename e regenerate sono riservati all'OWNER.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { generateInviteCode } from "../lib/inviteCode.js";
import { broadcast } from "../lib/ws.js";
import { ensureAccounts } from "../lib/accounts.js";

const router = Router();
router.use(authMiddleware);

function requireOwner(req, res) {
  if (req.user.role !== "OWNER") {
    res.status(403).json({ error: "Solo il proprietario della famiglia può farlo" });
    return false;
  }
  return true;
}

// GET /api/household — dati famiglia + membri
router.get("/", async (req, res) => {
  const household = await prisma.household.findUnique({
    where: { id: req.user.householdId },
    include: {
      users: {
        select: { id: true, name: true, email: true, role: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!household) {
    return res.status(404).json({ error: "Famiglia non trovata" });
  }
  res.json({
    id: household.id,
    name: household.name,
    inviteCode: household.inviteCode,
    createdAt: household.createdAt,
    openingBalance: household.openingBalance,
    openingBalanceDate: household.openingBalanceDate,
    members: household.users,
  });
});

// PUT /api/household — rename (solo OWNER)
router.put("/", async (req, res) => {
  if (!requireOwner(req, res)) return;
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Nome famiglia obbligatorio" });
  }
  const household = await prisma.household.update({
    where: { id: req.user.householdId },
    data: { name: name.trim() },
  });
  res.json({ id: household.id, name: household.name });
});

// PUT /api/household/opening-balance { openingBalance, openingBalanceDate } —
// "punto zero" del saldo effettivo (qualsiasi membro; null per rimuoverlo).
router.put("/opening-balance", async (req, res) => {
  const { openingBalance, openingBalanceDate } = req.body || {};
  let data;
  if (openingBalance == null || openingBalance === "") {
    data = { openingBalance: null, openingBalanceDate: null };
  } else {
    const n = Number(openingBalance);
    if (!Number.isFinite(n)) return res.status(400).json({ error: "openingBalance deve essere un numero" });
    const d = openingBalanceDate ? new Date(openingBalanceDate) : new Date();
    if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "openingBalanceDate non valida" });
    data = {
      openingBalance: n,
      openingBalanceDate: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())),
    };
  }
  const hh = req.user.householdId;
  // Con i conti: il punto zero della famiglia coincide con quello del conto predefinito
  // (gli altri conti si gestiscono da /api/accounts).
  const accounts = await prisma.bankAccount.findMany({ where: { householdId: hh } });
  if (accounts.length === 0) {
    await prisma.household.update({ where: { id: hh }, data });
    await ensureAccounts(hh); // crea "Conto principale" dal punto zero
  } else {
    const def = accounts.find((a) => a.isDefault) || accounts[0];
    await prisma.bankAccount.update({ where: { id: def.id }, data });
    const all = await prisma.bankAccount.findMany({ where: { householdId: hh } });
    const withOpening = all.filter((a) => a.openingBalance != null);
    await prisma.household.update({
      where: { id: hh },
      data: withOpening.length
        ? { openingBalance: Number(withOpening.reduce((s, a) => s + a.openingBalance, 0).toFixed(2)), openingBalanceDate: withOpening.reduce((m, a) => (!m || a.openingBalanceDate < m ? a.openingBalanceDate : m), null) }
        : { openingBalance: null, openingBalanceDate: null },
    });
  }
  const household = await prisma.household.findUnique({ where: { id: hh } });
  res.json({ openingBalance: household.openingBalance, openingBalanceDate: household.openingBalanceDate });
});

// POST /api/household/reset { confirm: "RICOMINCIA" } — ricomincia da capo (solo OWNER):
// cancella TUTTI i dati economici della famiglia e dei suoi membri (movimenti, tasse
// accantonate, scontrini, ricorrenze, obiettivi, budget, regole CSV, fatture, scadenze,
// prestiti, profili fiscali, saldo iniziale). Restano account, famiglia e codice invito.
router.post("/reset", async (req, res) => {
  if (!requireOwner(req, res)) return;
  if (req.body?.confirm !== "RICOMINCIA") {
    return res.status(400).json({ error: 'Per confermare scrivi esattamente "RICOMINCIA"' });
  }
  const hh = req.user.householdId;
  const users = await prisma.user.findMany({ where: { householdId: hh }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.$transaction([
    prisma.goalContribution.deleteMany({ where: { goal: { householdId: hh } } }),
    prisma.savingsGoal.deleteMany({ where: { householdId: hh } }),
    prisma.internalLoan.deleteMany({ where: { userId: { in: ids } } }),
    prisma.invoice.deleteMany({ where: { userId: { in: ids } } }),
    prisma.taxDeadline.deleteMany({ where: { userId: { in: ids } } }),
    prisma.fiscalProfile.deleteMany({ where: { userId: { in: ids } } }),
    prisma.arubaConnection.deleteMany({ where: { userId: { in: ids } } }),
    prisma.receiptItem.deleteMany({ where: { receipt: { householdId: hh } } }),
    prisma.receipt.deleteMany({ where: { householdId: hh } }),
    prisma.taxSaving.deleteMany({ where: { transaction: { householdId: hh } } }),
    prisma.transaction.deleteMany({ where: { householdId: hh } }),
    prisma.recurringRule.deleteMany({ where: { householdId: hh } }),
    prisma.categoryBudget.deleteMany({ where: { householdId: hh } }),
    prisma.categoryRule.deleteMany({ where: { householdId: hh } }),
    prisma.recurringProduct.deleteMany({ where: { householdId: hh } }),
    prisma.shoppingListDismissal.deleteMany({ where: { householdId: hh } }),
    prisma.bankAccount.deleteMany({ where: { householdId: hh } }),
    prisma.household.update({ where: { id: hh }, data: { openingBalance: null, openingBalanceDate: null, csvMapping: null } }),
  ]);
  broadcast(hh, { event: "transaction_update", payload: { action: "reset" } });
  broadcast(hh, { event: "goal_update", payload: { action: "reset" } });
  broadcast(hh, { event: "recurring_update", payload: { action: "reset" } });
  res.json({ ok: true });
});

// POST /api/household/regenerate-invite — nuovo codice invito (solo OWNER).
// Il vecchio codice smette subito di funzionare.
router.post("/regenerate-invite", async (req, res) => {
  if (!requireOwner(req, res)) return;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const household = await prisma.household.update({
        where: { id: req.user.householdId },
        data: { inviteCode: generateInviteCode() },
      });
      return res.json({ inviteCode: household.inviteCode });
    } catch (err) {
      if (err?.code === "P2002") continue; // collisione: riprova
      throw err;
    }
  }
  res.status(500).json({ error: "Impossibile generare un codice invito univoco" });
});

export default router;
