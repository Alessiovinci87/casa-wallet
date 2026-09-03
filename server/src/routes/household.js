// Gestione famiglia: info + membri, rename, rigenerazione codice invito.
// Rename e regenerate sono riservati all'OWNER.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { generateInviteCode } from "../lib/inviteCode.js";

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
  const household = await prisma.household.update({ where: { id: req.user.householdId }, data });
  res.json({ openingBalance: household.openingBalance, openingBalanceDate: household.openingBalanceDate });
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
