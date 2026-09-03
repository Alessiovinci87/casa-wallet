// Prestiti interni dal fondo tasse — PERSONALI. I guardrail vivono in lib/loans.js.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { DEFAULT_MAX_PERCENT, checkInternalLoans, createInternalLoan, enrichLoan, loansSummary } from "../lib/loans.js";

const router = Router();
router.use(authMiddleware);

// GET /api/loans?includeClosed=true → { loans, outstanding, openCount, fundAvailable, maxPercent, cap }
router.get("/", async (req, res) => {
  const where = { userId: req.user.id };
  if (req.query.includeClosed !== "true") where.status = { in: ["OPEN", "LATE"] };
  const [loans, pending, profile, summary] = await Promise.all([
    prisma.internalLoan.findMany({ where, orderBy: { takenAt: "desc" } }),
    prisma.taxSaving.aggregate({ where: { transferred: false, transaction: { userId: req.user.id } }, _sum: { amount: true } }),
    prisma.fiscalProfile.findUnique({ where: { userId: req.user.id }, select: { maxSelfFinancePercent: true } }),
    loansSummary(req.user.id),
  ]);
  const fundAvailable = Number((pending._sum.amount || 0).toFixed(2));
  const maxPercent = profile?.maxSelfFinancePercent ?? DEFAULT_MAX_PERCENT;
  res.json({
    loans: loans.map((l) => enrichLoan(l)),
    outstanding: summary.outstanding,
    openCount: summary.openCount,
    fundAvailable,
    maxPercent,
    cap: Math.max(0, Number(((fundAvailable * maxPercent) / 100 - summary.outstanding).toFixed(2))),
  });
});

// POST /api/loans { amount, note?, scope? } → 201 | 400 con motivo del rifiuto
router.post("/", async (req, res) => {
  const { amount, note, scope } = req.body || {};
  const r = await createInternalLoan({ userId: req.user.id, householdId: req.user.householdId, amount, note, scope });
  if (r.error) return res.status(400).json({ error: r.error, code: r.code, cap: r.cap, maxPercent: r.maxPercent });
  res.status(201).json(r);
});

// POST /api/loans/:id/repay { amount } → registra una rata di rientro
router.post("/:id/repay", async (req, res) => {
  const loan = await prisma.internalLoan.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!loan) return res.status(404).json({ error: "Prestito non trovato" });
  if (loan.status === "REPAID") return res.status(409).json({ error: "Prestito già rientrato" });
  const n = Number(req.body?.amount);
  if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: "amount deve essere > 0" });
  const repaid = Number(Math.min(loan.amount, loan.repaid + n).toFixed(2));
  const updated = await prisma.internalLoan.update({
    where: { id: loan.id },
    data: { repaid, status: repaid >= loan.amount ? "REPAID" : "OPEN" },
  });
  res.json(enrichLoan(updated));
});

// DELETE /api/loans/:id — annulla (solo se nulla è ancora rientrato)
router.delete("/:id", async (req, res) => {
  const loan = await prisma.internalLoan.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!loan) return res.status(404).json({ error: "Prestito non trovato" });
  if (loan.repaid > 0) return res.status(409).json({ error: "Prestito con rate già rientrate: non si può annullare" });
  await prisma.internalLoan.delete({ where: { id: loan.id } });
  res.json({ ok: true, id: loan.id });
});

// POST /api/loans/check { force? } — trigger di test del controllo giornaliero
router.post("/check", async (req, res) => {
  res.json(await checkInternalLoans({ force: Boolean(req.body?.force) }));
});

export default router;
