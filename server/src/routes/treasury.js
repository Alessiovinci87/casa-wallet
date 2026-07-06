// Motore di tesoreria: profilo finanziario, simulatore di autofinanziamento,
// profilo fiscale con % minima suggerita (warning MAI bloccante).
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import {
  buildFinancialProfile,
  simulateSelfFinancing,
  computeSuggestedMinPercent,
} from "../lib/treasury.js";

const router = Router();
router.use(authMiddleware);

const REGIMES = new Set(["FORFETTARIO", "ORDINARIO", "ALTRO"]);
const SCOPES = new Set(["user", "household"]);

function parseParams(query) {
  const scope = SCOPES.has(query.scope) ? query.scope : "user";
  const months = Math.min(24, Math.max(3, Number(query.months) || 12));
  const rawBuffer = Number(query.buffer);
  const buffer = Number.isFinite(rawBuffer) ? Math.min(0.5, Math.max(0, rawBuffer)) : 0.1;
  return { scope, months, buffer };
}

// GET /api/treasury/profile?scope=user&months=12&buffer=0.1
router.get("/profile", async (req, res) => {
  const { scope, months, buffer } = parseParams(req.query);
  const profile = await buildFinancialProfile({
    userId: req.user.id,
    householdId: req.user.householdId,
    scope,
    months,
    buffer,
  });
  res.json(profile);
});

// POST /api/treasury/simulate  body: { amount, scope? }
router.post("/simulate", async (req, res) => {
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "amount deve essere un numero > 0" });
  }
  const scope = SCOPES.has(req.body?.scope) ? req.body.scope : "user";
  const result = await simulateSelfFinancing({
    userId: req.user.id,
    householdId: req.user.householdId,
    amount,
    scope,
  });
  res.json(result);
});

async function fiscalProfileResponse(userId) {
  const profile = await prisma.fiscalProfile.findUnique({ where: { userId } });
  const suggestedMinPercent = profile ? computeSuggestedMinPercent(profile) : null;
  const belowSuggested =
    profile?.defaultTaxPercent != null &&
    suggestedMinPercent != null &&
    profile.defaultTaxPercent < suggestedMinPercent;
  return { profile, suggestedMinPercent, belowSuggested };
}

// GET /api/treasury/fiscal-profile
router.get("/fiscal-profile", async (req, res) => {
  res.json(await fiscalProfileResponse(req.user.id));
});

// PUT /api/treasury/fiscal-profile
// body: { regime, partitaIva?, coeffRedditivita?, aliquotaImposta?, aliquotaInps?, defaultTaxPercent? }
router.put("/fiscal-profile", async (req, res) => {
  const { regime, partitaIva, coeffRedditivita, aliquotaImposta, aliquotaInps, defaultTaxPercent } =
    req.body || {};

  if (!regime || !REGIMES.has(regime)) {
    return res.status(400).json({ error: "regime non valido (FORFETTARIO | ORDINARIO | ALTRO)" });
  }
  if (partitaIva != null && partitaIva !== "" && !/^\d{11}$/.test(String(partitaIva))) {
    return res.status(400).json({ error: "partitaIva deve essere di 11 cifre" });
  }
  const inRange = (v, min, max, minExclusive = false) =>
    v == null || (Number.isFinite(Number(v)) && (minExclusive ? v > min : v >= min) && v <= max);
  if (!inRange(coeffRedditivita, 0, 1, true)) {
    return res.status(400).json({ error: "coeffRedditivita deve essere tra 0 (escluso) e 1" });
  }
  if (!inRange(aliquotaImposta, 0, 100) || !inRange(aliquotaInps, 0, 100) || !inRange(defaultTaxPercent, 0, 100)) {
    return res.status(400).json({ error: "le aliquote devono essere tra 0 e 100" });
  }

  const data = {
    regime,
    partitaIva: partitaIva || null,
    coeffRedditivita: coeffRedditivita ?? null,
    aliquotaImposta: aliquotaImposta ?? null,
    aliquotaInps: aliquotaInps ?? null,
    defaultTaxPercent: defaultTaxPercent ?? null,
  };
  await prisma.fiscalProfile.upsert({
    where: { userId: req.user.id },
    create: { userId: req.user.id, ...data },
    update: data,
  });

  // Stesso shape del GET: il client aggiorna profilo + warning in un colpo.
  // Se la % è sotto la minima suggerita si risponde comunque 200 (warning non bloccante).
  res.json(await fiscalProfileResponse(req.user.id));
});

export default router;
