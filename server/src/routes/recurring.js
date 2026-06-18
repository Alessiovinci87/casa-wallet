// Recurring products routes — mark a product as a fixed recurring purchase
// (always on the list) and/or set a manual repurchase interval. All protected.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();
router.use(authMiddleware);

// GET /api/recurring → recurring products for the user.
router.get("/", async (req, res) => {
  const items = await prisma.recurringProduct.findMany({
    where: { userId: req.user.id },
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

  const item = await prisma.recurringProduct.upsert({
    where: { userId_canonicalName: { userId: req.user.id, canonicalName } },
    update: data,
    create: { userId: req.user.id, canonicalName, ...data },
  });
  res.json(item);
});

// DELETE /api/recurring/:canonicalName → drop the recurring flag.
router.delete("/:canonicalName", async (req, res) => {
  const canonicalName = decodeURIComponent(req.params.canonicalName);
  await prisma.recurringProduct.deleteMany({
    where: { userId: req.user.id, canonicalName },
  });
  res.json({ ok: true, canonicalName });
});

export default router;
