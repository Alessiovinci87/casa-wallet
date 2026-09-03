// Conti bancari della famiglia (`/api/accounts`):
//   GET    /            → { accounts: [...con saldo], balance }
//   POST   /            { name, number?, openingBalance?, openingBalanceDate?, isDefault? } → 201
//   PUT    /:id         update parziale (stessi campi)
//   DELETE /:id         (le transazioni e le regole del conto passano al predefinito)
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { broadcast } from "../lib/ws.js";
import { computeAccountBalances, normalizeAccountNumber } from "../lib/accounts.js";

const router = Router();
router.use(authMiddleware);

function parseBody(body, partial = false) {
  const out = {};
  if (body.name !== undefined || !partial) {
    const name = String(body.name || "").trim();
    if (!name) throw Object.assign(new Error("Il nome del conto è obbligatorio"), { status: 400 });
    out.name = name.slice(0, 60);
  }
  if (body.number !== undefined) {
    const n = String(body.number || "").trim();
    out.number = n ? n.slice(0, 40) : null;
    if (n && normalizeAccountNumber(n).length < 5) throw Object.assign(new Error("Numero di conto troppo corto"), { status: 400 });
  }
  if (body.openingBalance !== undefined) {
    if (body.openingBalance === null || body.openingBalance === "") {
      out.openingBalance = null;
      out.openingBalanceDate = null;
    } else {
      const v = Number(body.openingBalance);
      if (!Number.isFinite(v)) throw Object.assign(new Error("Saldo iniziale non valido"), { status: 400 });
      out.openingBalance = v;
      const d = body.openingBalanceDate ? new Date(body.openingBalanceDate) : new Date();
      if (Number.isNaN(d.getTime())) throw Object.assign(new Error("Data non valida"), { status: 400 });
      out.openingBalanceDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
  } else if (body.openingBalanceDate !== undefined && body.openingBalanceDate) {
    const d = new Date(body.openingBalanceDate);
    if (Number.isNaN(d.getTime())) throw Object.assign(new Error("Data non valida"), { status: 400 });
    out.openingBalanceDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  if (body.isDefault !== undefined) out.isDefault = Boolean(body.isDefault);
  if (body.sortOrder !== undefined) out.sortOrder = Number(body.sortOrder) || 0;
  return out;
}

async function syncHouseholdOpening(householdId) {
  // Il punto zero della famiglia resta la somma dei punti zero dei conti (compatibilità).
  const accounts = await prisma.bankAccount.findMany({ where: { householdId } });
  const withOpening = accounts.filter((a) => a.openingBalance != null);
  const sum = withOpening.reduce((s, a) => s + a.openingBalance, 0);
  const minDate = withOpening.reduce((m, a) => (!m || a.openingBalanceDate < m ? a.openingBalanceDate : m), null);
  await prisma.household.update({
    where: { id: householdId },
    data: withOpening.length ? { openingBalance: Number(sum.toFixed(2)), openingBalanceDate: minDate } : { openingBalance: null, openingBalanceDate: null },
  });
}

router.get("/", async (req, res) => {
  const data = await computeAccountBalances(req.user.householdId);
  res.json(data);
});

router.post("/", async (req, res) => {
  try {
    const data = parseBody(req.body || {});
    const hh = req.user.householdId;
    const count = await prisma.bankAccount.count({ where: { householdId: hh } });
    const account = await prisma.$transaction(async (tx) => {
      const makeDefault = data.isDefault || count === 0;
      if (makeDefault) await tx.bankAccount.updateMany({ where: { householdId: hh }, data: { isDefault: false } });
      return tx.bankAccount.create({ data: { ...data, isDefault: makeDefault, householdId: hh } });
    });
    await syncHouseholdOpening(hh);
    broadcast(hh, { event: "transaction_update", payload: { action: "account_created" } });
    res.status(201).json({ account });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// PUT /api/accounts/reorder { ids: [...] } → posizione in Home = indice nell'array
router.put("/reorder", async (req, res) => {
  const hh = req.user.householdId;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  const mine = await prisma.bankAccount.findMany({ where: { householdId: hh }, select: { id: true } });
  const allowed = new Set(mine.map((a) => a.id));
  await prisma.$transaction(ids.filter((id) => allowed.has(id)).map((id, i) => prisma.bankAccount.update({ where: { id }, data: { sortOrder: i } })));
  broadcast(hh, { event: "transaction_update", payload: { action: "account_reordered" } });
  res.json(await computeAccountBalances(hh));
});

router.put("/:id", async (req, res) => {
  try {
    const hh = req.user.householdId;
    const existing = await prisma.bankAccount.findFirst({ where: { id: req.params.id, householdId: hh } });
    if (!existing) return res.status(404).json({ error: "Conto non trovato" });
    const data = parseBody(req.body || {}, true);
    const account = await prisma.$transaction(async (tx) => {
      if (data.isDefault) await tx.bankAccount.updateMany({ where: { householdId: hh }, data: { isDefault: false } });
      if (data.isDefault === false && existing.isDefault) delete data.isDefault; // il predefinito non si spegne: se ne elegge un altro
      return tx.bankAccount.update({ where: { id: existing.id }, data });
    });
    await syncHouseholdOpening(hh);
    broadcast(hh, { event: "transaction_update", payload: { action: "account_updated" } });
    res.json({ account });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  const hh = req.user.householdId;
  const existing = await prisma.bankAccount.findFirst({ where: { id: req.params.id, householdId: hh } });
  if (!existing) return res.status(404).json({ error: "Conto non trovato" });
  const others = await prisma.bankAccount.findMany({ where: { householdId: hh, id: { not: existing.id } }, orderBy: { createdAt: "asc" } });
  if (others.length === 0) return res.status(409).json({ error: "Non puoi eliminare l'unico conto" });
  const target = others.find((a) => a.isDefault) || others[0];
  await prisma.$transaction([
    prisma.transaction.updateMany({ where: { accountId: existing.id }, data: { accountId: target.id } }),
    prisma.recurringRule.updateMany({ where: { accountId: existing.id }, data: { accountId: target.id } }),
    prisma.bankAccount.delete({ where: { id: existing.id } }),
    prisma.bankAccount.update({ where: { id: target.id }, data: { isDefault: true } }),
  ]);
  await syncHouseholdOpening(hh);
  broadcast(hh, { event: "transaction_update", payload: { action: "account_deleted" } });
  res.json({ ok: true, movedTo: target.id });
});

export default router;
