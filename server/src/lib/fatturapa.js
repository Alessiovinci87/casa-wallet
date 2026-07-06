// Parser FatturaPA (fattura elettronica italiana, tracciato FPR12/FPA12).
// Puro: nessun I/O, prende la stringa XML e restituisce dati normalizzati.
//
// Scelte di robustezza (dal tracciato ufficiale v1.2.3):
// - namespace-agnostic (removeNSPrefix): i prefissi variano tra emittenti
// - un file può contenere PIÙ FatturaElettronicaBody (lotto) → una fattura per body
// - ImportoTotaleDocumento è OPZIONALE: i totali si calcolano SEMPRE da DatiRiepilogo
// - aritmetica in centesimi interi (mai float sui soldi)
import { XMLParser } from "fast-xml-parser";

export class FatturaPAError extends Error {}

// Tipi documento accettati in v1 (fattura, parcella, fattura differita).
const ACCEPTED_TYPES = new Set(["TD01", "TD06", "TD24", "TD25"]);

const ARRAY_NODES = new Set([
  "FatturaElettronicaBody",
  "DettaglioLinee",
  "DatiRiepilogo",
  "DatiRitenuta",
  "DatiCassaPrevidenziale",
  "DatiPagamento",
  "DettaglioPagamento",
]);

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false, // importi e identificativi restano stringhe
  isArray: (name) => ARRAY_NODES.has(name),
});

/** true se il buffer è un p7m firmato (DER o PEM) e non XML puro. */
export function sniffP7m(buffer) {
  // Salta BOM UTF-8 e whitespace iniziale.
  let i = 0;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) i = 3;
  while (i < buffer.length && [0x20, 0x09, 0x0a, 0x0d].includes(buffer[i])) i++;
  if (i >= buffer.length) return false;
  if (buffer[i] === 0x30) return true; // DER SEQUENCE
  const head = buffer.slice(i, i + 20).toString("latin1");
  return head.startsWith("-----BEGIN PKCS7");
}

/** "1234.56" → 123456 centesimi interi. Lancia su formati non standard. */
function toCents(raw, field) {
  if (raw == null || raw === "") return 0;
  const str = String(raw).trim();
  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    throw new FatturaPAError(`Importo non valido in ${field}: "${str}"`);
  }
  const negative = str.startsWith("-");
  const [intPart, decPart = ""] = str.replace("-", "").split(".");
  // Arrotonda la parte decimale a 2 cifre (l'XSD ammette fino a 8).
  const decimals = (decPart + "000").slice(0, 3);
  let cents = Number(intPart) * 100 + Math.round(Number(decimals) / 10);
  return negative ? -cents : cents;
}

const euros = (cents) => Math.round(cents) / 100;

/** Denominazione XOR Nome+Cognome (scelta del tracciato). */
function anagraficaName(anagrafica) {
  if (!anagrafica) return null;
  if (anagrafica.Denominazione) return String(anagrafica.Denominazione).trim();
  const nome = anagrafica.Nome ? String(anagrafica.Nome).trim() : "";
  const cognome = anagrafica.Cognome ? String(anagrafica.Cognome).trim() : "";
  return `${nome} ${cognome}`.trim() || null;
}

function parseParty(node) {
  const dati = node?.DatiAnagrafici;
  return {
    vat: dati?.IdFiscaleIVA?.IdCodice ? String(dati.IdFiscaleIVA.IdCodice).trim() : null,
    cf: dati?.CodiceFiscale ? String(dati.CodiceFiscale).trim() : null,
    name: anagraficaName(dati?.Anagrafica),
  };
}

/**
 * Parsa un file FatturaPA. Ritorna header condiviso + una entry per body.
 * Le entry non importabili (nota di credito, divisa estera) hanno `skipped`.
 */
export function parseFatturaPA(xmlString) {
  let doc;
  try {
    doc = parser.parse(xmlString);
  } catch {
    throw new FatturaPAError("XML non valido o corrotto");
  }

  const root = doc.FatturaElettronica;
  if (!root) {
    throw new FatturaPAError("Il file non è una fattura elettronica (FatturaElettronica non trovato)");
  }

  const headerNode = root.FatturaElettronicaHeader;
  const bodies = root.FatturaElettronicaBody;
  if (!headerNode || !bodies?.length) {
    throw new FatturaPAError("Struttura FatturaPA incompleta (header o body mancanti)");
  }

  const supplier = parseParty(headerNode.CedentePrestatore);
  const customer = parseParty(headerNode.CessionarioCommittente);
  const header = {
    supplierVat: supplier.vat,
    supplierCf: supplier.cf,
    supplierName: supplier.name,
    regimeFiscale: headerNode.CedentePrestatore?.DatiAnagrafici?.RegimeFiscale ?? null,
    customerVat: customer.vat,
    customerCf: customer.cf,
    customerName: customer.name || "Cliente sconosciuto",
  };

  const invoices = bodies.map((body) => {
    const dg = body.DatiGenerali?.DatiGeneraliDocumento || {};
    const numero = dg.Numero != null ? String(dg.Numero).trim() : null;
    const dateStr = dg.Data ? String(dg.Data).trim() : null;
    const tipoDocumento = dg.TipoDocumento ? String(dg.TipoDocumento).trim() : "TD01";
    const divisa = dg.Divisa ? String(dg.Divisa).trim() : "EUR";

    if (!numero || !dateStr) {
      throw new FatturaPAError("Fattura senza Numero o Data");
    }
    const year = Number(dateStr.slice(0, 4));

    const base = { numero, year, date: dateStr, tipoDocumento, divisa };

    if (!ACCEPTED_TYPES.has(tipoDocumento)) {
      const label = tipoDocumento === "TD04" ? "Nota di credito (TD04)" : `Tipo documento ${tipoDocumento}`;
      return { ...base, skipped: { reason: `${label} non supportato in questa versione` } };
    }
    if (divisa !== "EUR") {
      return { ...base, skipped: { reason: `Divisa ${divisa} non supportata (solo EUR)` } };
    }

    // Totali dal riepilogo IVA (fonte autoritativa; include già la cassa).
    const riepiloghi = body.DatiBeniServizi?.DatiRiepilogo || [];
    if (riepiloghi.length === 0) {
      throw new FatturaPAError(`Fattura ${numero}: DatiRiepilogo mancante`);
    }
    let imponibileC = 0;
    let ivaC = 0;
    for (const r of riepiloghi) {
      imponibileC += toCents(r.ImponibileImporto, "ImponibileImporto");
      ivaC += toCents(r.Imposta, "Imposta");
    }

    const ritenute = dg.DatiRitenuta || [];
    const ritenutaC = ritenute.reduce((s, r) => s + toCents(r.ImportoRitenuta, "ImportoRitenuta"), 0);

    const casse = dg.DatiCassaPrevidenziale || [];
    const cassaC = casse.reduce(
      (s, c) => s + toCents(c.ImportoContributoCassa, "ImportoContributoCassa"),
      0
    );

    const bolloC = dg.DatiBollo?.ImportoBollo ? toCents(dg.DatiBollo.ImportoBollo, "ImportoBollo") : 0;

    const grossC = imponibileC + ivaC + bolloC;
    const netC = grossC - ritenutaC;

    // Pagamenti: prima scadenza + somma importi per il cross-check.
    let dueDate = null;
    let paymentsC = 0;
    let hasPayments = false;
    for (const dp of body.DatiPagamento || []) {
      for (const det of dp.DettaglioPagamento || []) {
        hasPayments = true;
        if (det.ImportoPagamento != null) {
          paymentsC += toCents(det.ImportoPagamento, "ImportoPagamento");
        }
        if (!dueDate && det.DataScadenzaPagamento) {
          dueDate = String(det.DataScadenzaPagamento).trim();
        }
      }
    }

    // Cross-check (mai bloccanti: segnalano dati incoerenti nel file).
    const warnings = [];
    if (hasPayments && paymentsC > 0 && Math.abs(paymentsC - netC) > 1) {
      warnings.push("PAGAMENTI_NON_COINCIDONO");
    }
    if (dg.ImportoTotaleDocumento != null) {
      const dichiaratoC = toCents(dg.ImportoTotaleDocumento, "ImportoTotaleDocumento");
      if (Math.abs(dichiaratoC - grossC) > 1) {
        warnings.push("TOTALE_DOCUMENTO_DIVERSO");
      }
    }

    return {
      ...base,
      imponibile: euros(imponibileC),
      iva: euros(ivaC),
      ritenuta: euros(ritenutaC),
      cassa: euros(cassaC),
      bollo: euros(bolloC),
      grossTotal: euros(grossC),
      netToPay: euros(netC),
      dueDate,
      warning: warnings.length ? warnings.join(",") : null,
      skipped: null,
    };
  });

  return { header, invoices, warnings: [] };
}
