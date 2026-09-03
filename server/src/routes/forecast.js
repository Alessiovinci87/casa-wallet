// Previsione cash-flow: GET /api/forecast?days=90
import { Router } from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { buildForecast } from "../lib/forecast.js";

const router = Router();
router.use(authMiddleware);

router.get("/", async (req, res) => {
  const days = Math.min(365, Math.max(7, Number(req.query.days) || 90));
  const result = await buildForecast({ householdId: req.user.householdId, userId: req.user.id, days });
  res.json(result);
});

export default router;
