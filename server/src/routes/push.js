// Web Push subscription management — protected. The client fetches the VAPID
// public key, subscribes via the browser PushManager, and registers the
// subscription here so the server can deliver notifications.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { getPublicKey, sendPushToUser } from "../lib/push.js";

const router = Router();
router.use(authMiddleware);

// GET /api/push/public-key → { publicKey } (null if push not configured server-side)
router.get("/public-key", (_req, res) => {
  res.json({ publicKey: getPublicKey() });
});

// POST /api/push/subscribe → store/refresh a browser subscription for this user.
router.post("/subscribe", async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: "Subscription non valida" });
  }

  const sub = await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: req.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    update: { userId: req.user.id, p256dh: keys.p256dh, auth: keys.auth },
  });
  res.status(201).json({ ok: true, id: sub.id });
});

// POST /api/push/unsubscribe → remove one of OWN subscriptions by endpoint.
router.post("/unsubscribe", async (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) {
    await prisma.pushSubscription.deleteMany({
      where: { endpoint, userId: req.user.id },
    });
  }
  res.json({ ok: true });
});

// POST /api/push/test → send a test notification to the caller's devices.
router.post("/test", async (req, res) => {
  const result = await sendPushToUser(req.user.id, {
    title: "Awareness",
    body: "Notifica di prova ✅",
    url: "/",
  });
  res.json(result);
});

export default router;
