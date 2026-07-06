// Auth routes: register (crea famiglia o join con codice invito), login, refresh, me.
import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { createHouseholdWithUniqueCode } from "../lib/inviteCode.js";

const router = Router();

const TOKEN_TTL = "7d";
const MIN_PASSWORD_LENGTH = 8;

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      householdId: user.householdId,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    householdId: user.householdId,
    role: user.role,
  };
}

// POST /api/auth/register
// body: { name, email, password, householdName? XOR inviteCode? }
//  - householdName → crea una nuova famiglia, l'utente è OWNER
//  - inviteCode    → si unisce alla famiglia esistente come MEMBER
router.post("/register", async (req, res) => {
  const { name, email, password, householdName, inviteCode } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ error: "Nome, email e password obbligatori" });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res
      .status(400)
      .json({ error: `La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri` });
  }
  if ((!householdName && !inviteCode) || (householdName && inviteCode)) {
    return res.status(400).json({
      error: "Indica il nome della nuova famiglia oppure un codice invito (non entrambi)",
    });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "Email già registrata" });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  let user;
  let household;
  if (householdName) {
    // Modalità A: nuova famiglia + utente OWNER, atomico.
    ({ user, household } = await prisma.$transaction(async (tx) => {
      const h = await createHouseholdWithUniqueCode(tx, householdName.trim());
      const u = await tx.user.create({
        data: { name, email, passwordHash, householdId: h.id, role: "OWNER" },
      });
      return { user: u, household: h };
    }));
  } else {
    // Modalità B: join con codice invito.
    household = await prisma.household.findUnique({
      where: { inviteCode: String(inviteCode).trim().toUpperCase() },
    });
    if (!household) {
      return res.status(404).json({ error: "Codice invito non valido" });
    }
    user = await prisma.user.create({
      data: { name, email, passwordHash, householdId: household.id, role: "MEMBER" },
    });
  }

  const token = signToken(user);
  res.status(201).json({
    token,
    user: publicUser(user),
    household: { id: household.id, name: household.name, inviteCode: household.inviteCode },
  });
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email e password obbligatorie" });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: "Credenziali non valide" });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Credenziali non valide" });
  }

  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

// POST /api/auth/refresh — issue a fresh token for the current (still valid) one.
// Rilegge l'utente dal DB, quindi i claims (householdId/role) sono sempre freschi.
router.post("/refresh", authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) {
    return res.status(401).json({ error: "Utente non trovato" });
  }
  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

// GET /api/auth/me
router.get("/me", authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, name: true, email: true, householdId: true, role: true },
  });
  if (!user) {
    return res.status(404).json({ error: "Utente non trovato" });
  }
  res.json({ user });
});

export default router;
