// Consulente (`/api/advisor`):
//   GET  /report?months=3  → resoconto con capacità, verdetti obiettivi, tagli proposti, testo esportabile
//   POST /send { force? }   → invia subito la notifica trimestrale alla propria famiglia (test)
import { Router } from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { buildAdvisorReport, sendQuarterlyReports } from "../lib/advisor.js";
import { sendPushToHousehold } from "../lib/push.js";
import { sendEmail } from "../lib/email.js";
import { prisma } from "../lib/prisma.js";

const router = Router();
router.use(authMiddleware);

router.get("/report", async (req, res) => {
  try {
    const report = await buildAdvisorReport({ householdId: req.user.householdId, userId: req.user.id, months: req.query.months });
    res.json(report);
  } catch (err) {
    console.error("[advisor]", err);
    res.status(500).json({ error: "Resoconto non disponibile" });
  }
});

router.post("/send", async (req, res) => {
  const hh = req.user.householdId;
  // Solo la propria famiglia: filtro passando un sendPush/sendEmail che ignorano le altre.
  const result = await sendQuarterlyReports({
    force: Boolean(req.body?.force),
    sendPushToHousehold: (id, msg) => (id === hh ? sendPushToHousehold(id, msg) : null),
    sendEmail: async (msg) => {
      const u = await prisma.user.findFirst({ where: { email: msg.to, householdId: hh }, select: { id: true } });
      return u ? sendEmail(msg) : null;
    },
  });
  res.json(result);
});

export default router;
