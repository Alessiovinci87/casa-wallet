// Predictive shopping list routes — all protected.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { broadcast } from "../lib/ws.js";
import { computeShoppingList } from "../lib/shoppingPredictor.js";

const router = Router();
router.use(authMiddleware);

// GET /api/shopping-list?onlyDue=true — lista unica per tutta la famiglia.
router.get("/", async (req, res) => {
  const list = await computeShoppingList(req.user.householdId);
  const onlyDue = req.query.onlyDue === "true";
  res.json(onlyDue ? list.filter((p) => p.isDue) : list);
});

// POST /api/shopping-list/dismiss  body: { canonicalName }
// Hides a product from the family list until it is purchased again.
router.post("/dismiss", async (req, res) => {
  const { canonicalName } = req.body || {};
  if (!canonicalName) {
    return res.status(400).json({ error: "canonicalName obbligatorio" });
  }

  const householdId = req.user.householdId;
  const dismissal = await prisma.shoppingListDismissal.upsert({
    where: { householdId_canonicalName: { householdId, canonicalName } },
    update: { dismissedAt: new Date() },
    create: { householdId, canonicalName },
  });

  broadcast(householdId, { event: "shopping_list_update", payload: { action: "dismissed", canonicalName } });
  res.json(dismissal);
});

export default router;
