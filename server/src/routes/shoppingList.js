// Predictive shopping list routes — all protected.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { broadcast } from "../lib/ws.js";
import { computeShoppingList } from "../lib/shoppingPredictor.js";

const router = Router();
router.use(authMiddleware);

// GET /api/shopping-list?onlyDue=true
router.get("/", async (req, res) => {
  const list = await computeShoppingList(req.user.id);
  const onlyDue = req.query.onlyDue === "true";
  res.json(onlyDue ? list.filter((p) => p.isDue) : list);
});

// POST /api/shopping-list/dismiss  body: { canonicalName }
// Hides a product from the list until it is purchased again.
router.post("/dismiss", async (req, res) => {
  const { canonicalName } = req.body || {};
  if (!canonicalName) {
    return res.status(400).json({ error: "canonicalName obbligatorio" });
  }

  const dismissal = await prisma.shoppingListDismissal.upsert({
    where: { userId_canonicalName: { userId: req.user.id, canonicalName } },
    update: { dismissedAt: new Date() },
    create: { userId: req.user.id, canonicalName },
  });

  broadcast({ event: "shopping_list_update", payload: { action: "dismissed", canonicalName } });
  res.json(dismissal);
});

export default router;
