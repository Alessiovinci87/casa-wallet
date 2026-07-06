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
