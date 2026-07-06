// Recurring products routes — mark a product as a fixed recurring purchase
// (always on the list) and/or set a manual repurchase interval. All protected.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();
router.use(authMiddleware);

// GET /api/recurring → recurring products for the family.
router.get("/", async (req, res) => {
  const items = await prisma.recurringProduct.findMany({
    where: { householdId: req.user.householdId },
    orderBy: { canonicalName: "asc" },
  });
  res.json(items);
});

// POST /api/recurring  body: { canonicalName, alwaysBuy?, intervalDays? }
router.post("/", async (req, res) => {
  const { canonicalName, alwaysBuy, intervalDays } = req.body || {};
  if (!canonicalName) {
    return res.status(400).json({ error: "canonicalName obbligatorio" });
  }

  const data = {
    alwaysBuy: alwaysBuy ?? false,
    intervalDays: intervalDays ?? null,
  };

  const householdId = req.user.householdId;
  const item = await prisma.recurringProduct.upsert({
    where: { householdId_canonicalName: { householdId, canonicalName } },
    update: data,
    create: { householdId, canonicalName, ...data },
  });
  res.json(item);
});

// DELETE /api/recurring/:canonicalName → drop the recurring flag.
router.delete("/:canonicalName", async (req, res) => {
  const canonicalName = decodeURIComponent(req.params.canonicalName);
  await prisma.recurringProduct.deleteMany({
    where: { householdId: req.user.householdId, canonicalName },
  });
  res.json({ ok: true, canonicalName });
});

export default router;
