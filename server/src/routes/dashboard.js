// Dashboard: il Disponibile reale (saldo − tasse pending − obiettivi − fisse residue − prestiti).
import { Router } from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { computeAvailable } from "../lib/available.js";

const router = Router();
router.use(authMiddleware);

// GET /api/dashboard/available
router.get("/available", async (req, res) => {
  try {
    const result = await computeAvailable({ householdId: req.user.householdId, userId: req.user.id });
    res.json(result);
  } catch (err) {
    // Token valido ma famiglia inesistente (es. DB azzerato): 401 → il client fa logout e torna al login.
    if (err?.message === "Famiglia non trovata") {
      return res.status(401).json({ error: "Sessione non più valida, effettua di nuovo l'accesso" });
    }
    throw err;
  }
});

export default router;
