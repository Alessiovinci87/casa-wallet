// Auth routes: register (crea famiglia o join con codice invito), login, refresh, me,
// verifica email (non bloccante: banner nel client finché emailVerifiedAt è null).
import crypto from "node:crypto";
import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { createHouseholdWithUniqueCode } from "../lib/inviteCode.js";
import { sendEmail } from "../lib/email.js";

const router = Router();

const TOKEN_TTL = "7d";
const MIN_PASSWORD_LENGTH = 8;

const newVerifyToken = () => crypto.randomBytes(32).toString("hex");

// Fire-and-forget: la registrazione non deve fallire se Resend è giù/assente.
function sendVerificationEmail(req, user, token) {
  const verifyUrl = `${req.protocol}://${req.get("host")}/api/auth/verify-email?token=${token}`;
  sendEmail({
    to: user.email,
    subject: "Awareness — conferma la tua email",
    html:
      `<p>Ciao ${user.name},</p>` +
      `<p>conferma il tuo indirizzo email per completare la registrazione a Awareness:</p>` +
      `<p><a href="${verifyUrl}">Conferma email</a></p>` +
      `<p style="color:#888;font-size:12px">Se non ti sei registrato tu, ignora questo messaggio.</p>`,
  }).catch((err) => console.error("[auth] invio email verifica fallito:", err.message));
}

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
    emailVerified: !!user.emailVerifiedAt,
  };
}

// POST /api/auth/register
// body: { name, email, password, householdName? XOR inviteCode? }
//  - householdName → crea una nuova famiglia, l'utente è OWNER
//  - inviteCode    → si unisce alla famiglia esistente come MEMBER
router.post("/register", async (req, res) => {
  const { name, password, householdName, inviteCode } = req.body || {};
  // Email normalizzata: "Mario@x.com" e "mario@x.com" sono lo stesso account.
  const email = String(req.body?.email || "").trim().toLowerCase();

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
  const emailVerifyToken = newVerifyToken();

  try {
    if (householdName) {
      // Modalità A: nuova famiglia + utente OWNER, atomico.
      ({ user, household } = await prisma.$transaction(async (tx) => {
        const h = await createHouseholdWithUniqueCode(tx, householdName.trim());
        const u = await tx.user.create({
          data: { name, email, passwordHash, householdId: h.id, role: "OWNER", emailVerifyToken },
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
        data: { name, email, passwordHash, householdId: household.id, role: "MEMBER", emailVerifyToken },
      });
    }
  } catch (err) {
    // Race sul check email: due registrazioni concorrenti → unique violation.
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "Email già registrata" });
    }
    throw err;
  }

  sendVerificationEmail(req, user, emailVerifyToken);

  const token = signToken(user);
  res.status(201).json({
    token,
    user: publicUser(user),
    household: { id: household.id, name: household.name, inviteCode: household.inviteCode },
  });
});

// GET /api/auth/verify-email?token= — link cliccato dall'email: pagina HTML minima.
router.get("/verify-email", async (req, res) => {
  const token = String(req.query.token || "");
  const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
  const page = (title, body) =>
    `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<body style="font-family:system-ui;display:flex;min-height:90vh;align-items:center;justify-content:center">` +
    `<div style="text-align:center"><h2>${title}</h2><p>${body}</p>` +
    `<p><a href="${clientUrl}" style="color:#7c3aed">Vai a Awareness</a></p></div></body></html>`;

  if (!token) return res.status(400).send(page("Link non valido", "Manca il token di verifica."));

  const user = await prisma.user.findUnique({ where: { emailVerifyToken: token } });
  if (!user) {
    return res.status(404).send(page("Link non valido o già usato", "Richiedi un nuovo link dall'app."));
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date(), emailVerifyToken: null },
  });
  res.send(page("Email verificata ✓", `Grazie ${user.name}, il tuo account è confermato.`));
});

// POST /api/auth/resend-verification — reinvia il link all'utente loggato.
router.post("/resend-verification", authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: "Utente non trovato" });
  if (user.emailVerifiedAt) return res.status(409).json({ error: "Email già verificata" });

  const emailVerifyToken = newVerifyToken();
  await prisma.user.update({ where: { id: user.id }, data: { emailVerifyToken } });
  sendVerificationEmail(req, user, emailVerifyToken);
  res.json({ ok: true, sent: !!process.env.RESEND_API_KEY });
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { password } = req.body || {};
  const email = String(req.body?.email || "").trim().toLowerCase();
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
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) {
    return res.status(404).json({ error: "Utente non trovato" });
  }
  res.json({ user: publicUser(user) });
});

export default router;
