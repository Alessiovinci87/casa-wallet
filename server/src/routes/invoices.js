// Fatture elettroniche (PERSONALI): import XML FatturaPA, incasso (crea
// l'entrata — regime di cassa), connettore Aruba. All protected.
import { Router } from "express";
import multer from "multer";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { broadcast } from "../lib/ws.js";
import { parseFatturaPA, sniffP7m, FatturaPAError } from "../lib/fatturapa.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import {
  arubaSignin,
  getArubaToken,
  invalidateArubaToken,
  listInvoicesOut,
  getInvoiceXml,
  ArubaError,
} from "../lib/arubaClient.js";

const router = Router();
router.use(authMiddleware);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 20 },
});

const INVOICE_STATUSES = new Set(["EMESSA", "INCASSATA"]);
const PAY_METHODS = new Set(["CASH", "POS", "CARD", "TRANSFER"]);

// Stesso criterio di transactions.js: TaxSaving solo su INCOME con % positiva.
function taxApplies(taxPercent) {
  return typeof taxPercent === "number" && taxPercent > 0;
}

/**
 * Importa i body parsati di un file nel DB dell'utente. Regole condivise tra
 * upload XML e sync Aruba: skip TD/divisa, blocco P.IVA altrui, dedupe.
 */
async function importParsed({ userId, parsed, filename, source, sdiStatus, userVat, imported, skipped, errors }) {
  // Blocco proprietà: se l'utente ha la P.IVA nel profilo, la fattura deve
  // essere emessa da lui (evita di importare fatture RICEVUTE come entrate).
  if (userVat && parsed.header.supplierVat && parsed.header.supplierVat !== userVat) {
    errors.push({
      file: filename,
      error: `La fattura risulta emessa da P.IVA ${parsed.header.supplierVat}, diversa dalla tua (${userVat})`,
    });
    return;
  }

  for (const inv of parsed.invoices) {
    if (inv.skipped) {
      skipped.push({ file: filename, numero: inv.numero, reason: inv.skipped.reason });
      continue;
    }

    const existing = await prisma.invoice.findFirst({
      where: { userId, numero: inv.numero, year: inv.year },
    });
    if (existing) {
      skipped.push({ file: filename, numero: inv.numero, reason: "Fattura già importata" });
      continue;
    }

    try {
      const created = await prisma.invoice.create({
        data: {
          userId,
          source,
          filename,
          numero: inv.numero,
          year: inv.year,
          date: new Date(inv.date),
          tipoDocumento: inv.tipoDocumento,
          customerName: parsed.header.customerName,
          customerVat: parsed.header.customerVat,
          imponibile: inv.imponibile,
          iva: inv.iva,
          ritenuta: inv.ritenuta,
          cassa: inv.cassa,
          bollo: inv.bollo,
          grossTotal: inv.grossTotal,
          netToPay: inv.netToPay,
          dueDate: inv.dueDate ? new Date(inv.dueDate) : null,
          sdiStatus: sdiStatus ?? null,
          warning: inv.warning,
        },
      });
      imported.push(created);
    } catch (err) {
      if (err?.code === "P2002") {
        // Race su upload concorrenti: stesso esito del pre-check.
        skipped.push({ file: filename, numero: inv.numero, reason: "Fattura già importata" });
      } else {
        throw err;
      }
    }
  }
}

// POST /api/invoices/import-xml — multipart campo "files" (uno o più .xml)
router.post("/import-xml", upload.array("files", 20), async (req, res) => {
  const files = req.files || [];
  if (files.length === 0) {
    return res.status(400).json({ error: "Nessun file caricato (campo 'files')" });
  }

  const fiscalProfile = await prisma.fiscalProfile.findUnique({
    where: { userId: req.user.id },
    select: { partitaIva: true },
  });
  const userVat = fiscalProfile?.partitaIva || null;

  const imported = [];
  const skipped = [];
  const errors = [];

  for (const file of files) {
    const name = file.originalname;
    try {
      if (sniffP7m(file.buffer)) {
        errors.push({ file: name, error: "File firmato .p7m non supportato: carica il file .xml non firmato" });
        continue;
      }
      const parsed = parseFatturaPA(file.buffer.toString("utf8"));
      await importParsed({
        userId: req.user.id,
        parsed,
        filename: name,
        source: "XML",
        userVat,
        imported,
        skipped,
        errors,
      });
    } catch (err) {
      if (err instanceof FatturaPAError) {
        errors.push({ file: name, error: err.message });
      } else {
        throw err;
      }
    }
  }

  res.json({
    imported,
    skipped,
    errors,
    ...(userVat
      ? {}
      : { warning: "Partita IVA non impostata nel profilo fiscale: impossibile verificare che le fatture siano tue" }),
  });
});

// GET /api/invoices?status=&year=
router.get("/", async (req, res) => {
  const where = { userId: req.user.id };
  if (req.query.status) {
    if (!INVOICE_STATUSES.has(req.query.status)) {
      return res.status(400).json({ error: "status non valido (EMESSA | INCASSATA)" });
    }
    where.status = req.query.status;
  }
  if (req.query.year) where.year = Number(req.query.year);

  const invoices = await prisma.invoice.findMany({
    where,
    include: { transaction: { select: { id: true, date: true, taxPercent: true } } },
    orderBy: { date: "desc" },
  });
  res.json(invoices);
});

// PUT /api/invoices/:id/collect — segna incassata: crea l'entrata (atomico)
router.put("/:id/collect", async (req, res) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!invoice) {
    return res.status(404).json({ error: "Fattura non trovata" });
  }
  if (invoice.status === "INCASSATA") {
    return res.status(409).json({ error: "Fattura già incassata" });
  }

  const { taxPercent, method, date } = req.body || {};
  if (method !== undefined && !PAY_METHODS.has(method)) {
    return res.status(400).json({ error: "method non valido (CASH | POS | CARD | TRANSFER)" });
  }
  if (taxPercent !== undefined && taxPercent !== null && (Number(taxPercent) < 0 || Number(taxPercent) > 100)) {
    return res.status(400).json({ error: "taxPercent deve essere tra 0 e 100" });
  }

  // % tasse: dal body, altrimenti dal profilo fiscale.
  let percent = taxPercent != null ? Number(taxPercent) : null;
  if (percent == null) {
    const fp = await prisma.fiscalProfile.findUnique({
      where: { userId: req.user.id },
      select: { defaultTaxPercent: true },
    });
    percent = fp?.defaultTaxPercent ?? null;
  }

  const when = date ? new Date(date) : new Date();
  const applies = taxApplies(percent);
  const taxAmount = applies ? Number((invoice.netToPay * percent) / 100) : null;

  const [transaction, updated] = await prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.create({
      data: {
        userId: req.user.id,
        householdId: req.user.householdId,
        amount: invoice.netToPay,
        type: "INCOME",
        category: "Fatture",
        method: method ?? "TRANSFER",
        description: `Fattura ${invoice.numero} — ${invoice.customerName}`,
        date: when,
        taxPercent: applies ? percent : null,
        taxAmount,
        ...(applies && {
          taxSaving: {
            create: {
              amount: taxAmount,
              month: when.getUTCMonth() + 1,
              year: when.getUTCFullYear(),
            },
          },
        }),
      },
      include: { taxSaving: true, user: { select: { id: true, name: true } } },
    });
    const updated = await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "INCASSATA", collectedAt: when, transactionId: transaction.id },
    });
    return [transaction, updated];
  });

  broadcast(req.user.householdId, {
    event: "transaction_update",
    payload: { action: "created", transaction },
  });
  broadcast(req.user.householdId, {
    event: "invoice_update",
    payload: { action: "collected", invoice: updated },
  });
  res.json({ invoice: updated, transaction });
});

// PUT /api/invoices/:id/uncollect — annulla l'incasso (rimuove l'entrata)
router.put("/:id/uncollect", async (req, res) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: { transaction: { include: { taxSaving: true } } },
  });
  if (!invoice) {
    return res.status(404).json({ error: "Fattura non trovata" });
  }
  if (invoice.status !== "INCASSATA") {
    return res.status(409).json({ error: "La fattura non risulta incassata" });
  }

  const tx = invoice.transaction;
  const updated = await prisma.$transaction(async (db) => {
    // Prima si stacca il FK, poi si elimina la transazione (vincolo relazione).
    const updated = await db.invoice.update({
      where: { id: invoice.id },
      data: { status: "EMESSA", collectedAt: null, transactionId: null },
    });
    if (tx) {
      if (tx.taxSaving) {
        await db.taxSaving.delete({ where: { id: tx.taxSaving.id } });
      }
      await db.transaction.delete({ where: { id: tx.id } });
    }
    return updated;
  });

  if (tx) {
    broadcast(req.user.householdId, {
      event: "transaction_update",
      payload: { action: "deleted", transaction: tx },
    });
  }
  broadcast(req.user.householdId, {
    event: "invoice_update",
    payload: { action: "uncollected", invoice: updated },
  });
  res.json({ invoice: updated });
});

// DELETE /api/invoices/:id — solo fatture non incassate
router.delete("/:id", async (req, res) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!invoice) {
    return res.status(404).json({ error: "Fattura non trovata" });
  }
  if (invoice.status === "INCASSATA") {
    return res.status(409).json({ error: "Fattura incassata: annulla prima l'incasso" });
  }
  await prisma.invoice.delete({ where: { id: invoice.id } });
  res.json({ ok: true, id: invoice.id });
});

// ---------- Connettore Aruba ----------

// GET /api/invoices/aruba — stato connessione (mai la password)
router.get("/aruba", async (req, res) => {
  const conn = await prisma.arubaConnection.findUnique({
    where: { userId: req.user.id },
    select: { username: true, lastSyncAt: true },
  });
  res.json(conn ? { connected: true, ...conn } : { connected: false });
});

// POST /api/invoices/aruba/connect — valida le credenziali e le salva cifrate
router.post("/aruba/connect", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username e password obbligatori" });
  }
  try {
    await arubaSignin(username, password); // valida subito
  } catch (err) {
    if (err instanceof ArubaError) {
      return res.status(err.status === 401 ? 400 : 502).json({ error: err.message });
    }
    throw err;
  }

  let encrypted;
  try {
    encrypted = encryptSecret(password);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  await prisma.arubaConnection.upsert({
    where: { userId: req.user.id },
    create: { userId: req.user.id, username, encryptedPassword: encrypted },
    update: { username, encryptedPassword: encrypted },
  });
  invalidateArubaToken(req.user.id);
  res.json({ connected: true, username });
});

// DELETE /api/invoices/aruba/connect
router.delete("/aruba/connect", async (req, res) => {
  await prisma.arubaConnection.deleteMany({ where: { userId: req.user.id } });
  invalidateArubaToken(req.user.id);
  res.json({ ok: true });
});

// POST /api/invoices/aruba/sync — importa le fatture inviate da Aruba
router.post("/aruba/sync", async (req, res) => {
  const conn = await prisma.arubaConnection.findUnique({ where: { userId: req.user.id } });
  if (!conn) {
    return res.status(400).json({ error: "Aruba non collegato" });
  }

  const fiscalProfile = await prisma.fiscalProfile.findUnique({
    where: { userId: req.user.id },
    select: { partitaIva: true },
  });
  const userVat = fiscalProfile?.partitaIva || null;

  const imported = [];
  const skipped = [];
  const errors = [];

  try {
    const password = decryptSecret(conn.encryptedPassword);
    const token = await getArubaToken(req.user.id, conn.username, password);

    const listOpts = { size: 100 };
    if (conn.lastSyncAt) listOpts.modifiedStartDate = conn.lastSyncAt.toISOString();

    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      const data = await listInvoicesOut(token, { ...listOpts, page });
      totalPages = data.totalPages ?? 1;
      for (const item of data.content || []) {
        const statuses = (item.invoices || []).map((i) => i.status);
        if (statuses.includes("Scartata")) {
          skipped.push({ file: item.filename, reason: "Scartata dallo SDI" });
          continue;
        }
        try {
          const xml = await getInvoiceXml(token, item.filename);
          const parsed = parseFatturaPA(xml);
          await importParsed({
            userId: req.user.id,
            parsed,
            filename: item.filename,
            source: "ARUBA",
            sdiStatus: statuses[0] ?? null,
            userVat,
            imported,
            skipped,
            errors,
          });
        } catch (err) {
          if (err instanceof FatturaPAError || err instanceof ArubaError) {
            errors.push({ file: item.filename, error: err.message });
          } else {
            throw err;
          }
        }
      }
      page++;
    }
  } catch (err) {
    if (err instanceof ArubaError) {
      return res.status(err.status === 429 ? 429 : 502).json({
        error: err.message,
        imported: imported.length,
        skipped: skipped.length,
        errors,
      });
    }
    if (err.message?.includes("INVOICE_CRED_SECRET")) {
      return res.status(500).json({ error: err.message });
    }
    throw err;
  }

  // lastSyncAt avanza solo su sync pulito: i falliti verranno ripresi.
  if (errors.length === 0) {
    await prisma.arubaConnection.update({
      where: { userId: req.user.id },
      data: { lastSyncAt: new Date() },
    });
  }

  res.json({ imported: imported.length, skipped: skipped.length, errors, invoices: imported });
});

export default router;
