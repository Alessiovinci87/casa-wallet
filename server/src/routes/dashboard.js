// Dashboard: il Disponibile reale (saldo − tasse pending − obiettivi − fisse residue − prestiti).
import { Router } from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { computeAvailable } from "../lib/available.js";

const router = Router();
router.use(authMiddleware);

// GET /api/dashboard/available
router.get("/available", async (req, res) => {
  const result = await computeAvailable({ householdId: req.user.householdId, userId: req.user.id });
  res.json(result);
});

export default router;
