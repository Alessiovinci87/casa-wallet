// Import estratto conto da formati diversi dal CSV: Excel (xls/xlsx e XML
// "SpreadsheetML"), XML bancari (ISO 20022 camt.052/053, CBI) e PDF.
// Ogni parser restituisce { format, rows: string[][], autoMapping? }: `rows`
// ha la stessa forma del CSV (prima riga = intestazioni) così il resto della
// pipeline (mapping, dedupe, categorie) resta identico. `autoMapping` è
// presente quando il formato è strutturato e le colonne non vanno scelte a mano.
import { XMLParser } from "fast-xml-parser";
import { createRequire } from "node:module";
import { parseCsv, detectDelimiter, parseDate, cleanDescription } from "./bankImport.js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
// pdf-parse 1.x: l'entry point esegue un test se caricato come modulo ESM → usiamo il lib.
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

const STD_HEADERS = ["Data", "Descrizione", "Importo"];
export const STD_MAPPING = { dateCol: 0, descCol: 1, amountCol: 2, debitCol: null, creditCol: null, hasHeader: true, invertSign: false };

export function detectFormat(filename = "", buffer) {
  const ext = String(filename).toLowerCase().split(".").pop();
  const head = buffer.subarray(0, 8);
  if (head.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (head[0] === 0x50 && head[1] === 0x4b) return "xlsx"; // zip
  if (head[0] === 0xd0 && head[1] === 0xcf) return "xls"; // OLE2
  const text = buffer.subarray(0, 512).toString("utf8").replace(/^﻿/, "").trimStart();
  if (text.startsWith("<")) return "xml";
  if (["pdf", "xlsx", "xls", "xml"].includes(ext)) return ext;
  return "csv";
}

/**
 * Numero di conto o IBAN citato nell'intestazione dell'estratto (per assegnare
 * i movimenti al conto giusto). Preferisce l'IBAN; altrimenti "Conto Corrente
 * 000070413523", "NUMERO 000070413523", "C/C=070413523".
 */
export function detectAccountNumber(text) {
  const t = String(text || "");
  const iban = t.match(/\bIT\s?\d{2}\s?[A-Z]\s?(?:\d\s?){10}(?:[A-Z0-9]\s?){12}\b/i);
  if (iban) return iban[0].replace(/\s+/g, "").toUpperCase();
  const cc = t.match(/(?:conto\s*corrente|c\/c|numero(?:\s+conto)?|n\.?\s*conto|account)\s*[:=]?\s*0*(\d{5,20})/i);
  if (cc) return cc[1];
  return null;
}

/** Punto d'ingresso: qualunque file → righe stile CSV (+ accountNumber se riconosciuto). */
export async function parseStatement(filename, buffer, decode) {
  const format = detectFormat(filename, buffer);
  let out;
  if (format === "pdf") out = await parsePdf(buffer);
  else if (format === "xlsx" || format === "xls") out = parseSheet(buffer, format);
  else if (format === "xml") out = parseXml(buffer, decode);
  else {
    const text = decode(buffer);
    const delimiter = detectDelimiter(text);
    out = { format: "csv", delimiter, rows: parseCsv(text, delimiter), accountNumber: detectAccountNumber(text.slice(0, 4000)) };
  }
  return out;
}

// ---------------------------------------------------------------- Excel

function parseSheet(buffer, format) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  // Foglio con più righe (alcune banche mettono un frontespizio nel primo).
  let best = null;
  for (const name of wb.SheetNames) {
    const rows = sheetRows(wb.Sheets[name]);
    if (!best || rows.length > best.length) best = rows;
  }
  const rows = trimToTable(best || []);
  const preamble = (best || []).slice(0, 30).map((r) => r.join(" ")).join("\n");
  return { format, rows, suggestedMapping: rows.length ? guessMapping(rows[0]) : null, accountNumber: detectAccountNumber(preamble) };
}

function sheetRows(ws) {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  return aoa.map((r) => r.map(cellToString));
}

function cellToString(v) {
  if (v == null) return "";
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === "number") return String(Math.round(v * 100) / 100).replace(".", ",");
  return String(v).trim();
}
const pad = (n) => String(n).padStart(2, "0");

const isDateCell = (c) => parseDate(c) != null;

/** Propone il mapping dalle intestazioni (Data operazione, Descrizione, Entrate/Uscite o Importo). */
export function guessMapping(headers) {
  const h = headers.map((x) => String(x || "").toLowerCase().trim());
  const find = (re) => { const i = h.findIndex((x) => re.test(x)); return i < 0 ? null : i; };
  const dateCol = find(/^data( operazione| contabile| op\.?| cont\.?)?$|^date$/) ?? find(/^data/);
  const descCol = find(/descrizione|causale|dettagl|description|memo/);
  const amountCol = find(/^importo|^amount|^ammontare/);
  const debitCol = find(/^uscite|^dare|^addebit|^debit/);
  const creditCol = find(/^entrate|^avere|^accredit|^credit/);
  if (dateCol == null || descCol == null || (amountCol == null && (debitCol == null || creditCol == null))) return null;
  const twoCols = debitCol != null && creditCol != null;
  return { dateCol, descCol, amountCol: twoCols ? null : amountCol, debitCol: twoCols ? debitCol : null, creditCol: twoCols ? creditCol : null, hasHeader: true, invertSign: false };
}

/**
 * Gli export bancari hanno spesso intestazione libera (IBAN, saldo, periodo)
 * prima della tabella: tiene le righe dalla prima "riga di intestazione" (≥3
 * celle piene, nessuna data) seguita da una riga con una data.
 */
export function trimToTable(rows) {
  const clean = rows.filter((r) => r.some((c) => String(c).trim() !== ""));
  for (let i = 0; i < clean.length - 1; i++) {
    const filled = clean[i].filter((c) => String(c).trim() !== "").length;
    if (filled >= 3 && !clean[i].some(isDateCell) && clean[i + 1].some(isDateCell)) {
      const width = Math.max(...clean.slice(i).map((r) => r.length));
      // Coda senza date (Totale, "Dati aggiornati al…") fuori.
      const body = clean.slice(i + 1).filter((r) => r.some(isDateCell));
      return [clean[i], ...body].map((r) => Array.from({ length: width }, (_, j) => r[j] ?? ""));
    }
  }
  return clean;
}

// ------------------------------------------------------------------ XML

function parseXml(buffer, decode) {
  const text = decode(buffer);
  // Excel 2003 XML (SpreadsheetML) o tabella HTML salvata come .xls/.xml → SheetJS.
  if (/urn:schemas-microsoft-com:office:spreadsheet|<Workbook|<table/i.test(text.slice(0, 2000))) {
    const wb = XLSX.read(text, { type: "string" });
    const rows = sheetRows(wb.Sheets[wb.SheetNames[0]]);
    const t = trimToTable(rows);
    return { format: "xml-excel", rows: t, suggestedMapping: t.length ? guessMapping(t[0]) : null };
  }
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: true });
  const doc = parser.parse(text);

  // ISO 20022 camt.052/053/054: Document > BkToCstmrStmt|BkToCstmrAcctRpt > Stmt|Rpt > Ntry[]
  const root = doc.Document || doc;
  const container = root.BkToCstmrStmt || root.BkToCstmrAcctRpt || root.BkToCstmrDbtCdtNtfctn;
  if (container) {
    const stmts = asArray(container.Stmt || container.Rpt || container.Ntfctn);
    const rows = [STD_HEADERS];
    for (const s of stmts) for (const e of asArray(s.Ntry)) rows.push(camtEntry(e));
    const acct = stmts[0]?.Acct?.Id;
    const accountNumber = acct?.IBAN || acct?.Othr?.Id || null;
    return { format: "camt", rows, autoMapping: STD_MAPPING, accountNumber };
  }

  // CBI e altri XML "tabellari": movimenti in elementi ripetuti.
  const generic = findRepeatedRecords(doc);
  if (generic) return { ...generic, accountNumber: detectAccountNumber(text.slice(0, 6000)) };
  throw new Error("XML non riconosciuto: attesi camt.053 (ISO 20022), CBI o Excel XML");
}

function camtEntry(e) {
  const date = e.BookgDt?.Dt || e.BookgDt?.DtTm?.slice(0, 10) || e.ValDt?.Dt || e.ValDt?.DtTm?.slice(0, 10) || "";
  const amt = typeof e.Amt === "object" ? e.Amt["#text"] : e.Amt;
  const sign = e.CdtDbtInd === "DBIT" ? "-" : "";
  const dtls = asArray(e.NtryDtls)[0];
  const tx = dtls ? asArray(dtls.TxDtls)[0] : null;
  const rmt = tx?.RmtInf ? asArray(tx.RmtInf.Ustrd).join(" ") : "";
  const party = tx?.RltdPties
    ? sign
      ? tx.RltdPties.Cdtr?.Nm || tx.RltdPties.Cdtr?.Pty?.Nm
      : tx.RltdPties.Dbtr?.Nm || tx.RltdPties.Dbtr?.Pty?.Nm
    : "";
  const desc = [party, rmt, e.AddtlNtryInf].filter(Boolean).join(" · ") || e.BkTxCd?.Prtry?.Cd || "Movimento";
  return [date, desc, `${sign}${String(amt).replace(".", ",")}`];
}

/**
 * Fallback per XML "tabellari" (CBI e simili): cerca l'array più numeroso di
 * oggetti che contengano almeno un campo data e uno numerico; le chiavi
 * diventano intestazioni e l'utente mappa le colonne come per un CSV.
 */
function findRepeatedRecords(doc) {
  let best = null;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    for (const v of Object.values(node)) {
      if (Array.isArray(v) && v.length >= 2 && v.every((x) => x && typeof x === "object")) {
        const flat = v.map((x) => flatten(x));
        const keys = [...new Set(flat.flatMap(Object.keys))];
        const hasDate = flat.some((r) => Object.values(r).some((c) => /^\d{4}-\d{2}-\d{2}|^\d{2}[\/.-]\d{2}[\/.-]\d{4}/.test(c)));
        const hasNum = flat.some((r) => Object.values(r).some((c) => /^[-+]?\d+([.,]\d+)?$/.test(c)));
        if (hasDate && hasNum && (!best || v.length > best.count)) best = { count: v.length, keys, flat };
      }
      visit(v);
    }
  };
  visit(doc);
  if (!best) return null;
  const rows = [best.keys, ...best.flat.map((r) => best.keys.map((k) => r[k] ?? ""))];
  // CBI: Segno D/C separato dall'importo → colonna "Importo con segno" aggiunta.
  const segnoKey = best.keys.find((k) => /segno|cdtdbt/i.test(k));
  const importoKey = best.keys.find((k) => /(^|\.)(importo|amount|amt)$/i.test(k));
  if (segnoKey && importoKey) {
    rows[0].push("Importo con segno");
    for (let i = 1; i < rows.length; i++) {
      const s = String(best.flat[i - 1][segnoKey]).toUpperCase();
      const neg = s.startsWith("D") || s === "-";
      rows[i].push(`${neg ? "-" : ""}${best.flat[i - 1][importoKey]}`);
    }
  }
  return { format: "xml", rows };
}

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("@_")) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else if (Array.isArray(v)) out[key] = v.map((x) => (typeof x === "object" ? JSON.stringify(x) : x)).join(" ");
    else out[key] = String(v ?? "");
  }
  return out;
}

const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);


// ------------------------------------------------------------------ PDF

const DATE_TOKEN = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/;
const AMOUNT_TOKEN = /^[-+]?\(?(?:€\s?)?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}\)?-?$/;

/**
 * Estratto conto PDF → righe. Legge il PDF con le coordinate dei frammenti di
 * testo (pdf.js) e ricostruisce le righe per Y e le colonne per X: una riga di
 * movimento inizia con una data (o due: contabile e valuta) e contiene almeno
 * un importo; le righe successive senza data sono la continuazione della
 * descrizione. Il segno si deduce, in ordine: dal segno esplicito; dal saldo
 * progressivo (ultimo importo) rispetto alla riga precedente; dalla colonna
 * dell'intestazione (Dare/Uscite/Addebiti vs Avere/Entrate/Accrediti) più
 * vicina in X; altrimenti il primo dei due importi è l'uscita.
 */
export async function parsePdf(buffer) {
  const lines = [];
  await pdfParse(buffer, {
    pagerender: async (page) => {
      const tc = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
      const byY = new Map();
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const y = Math.round(it.transform[5] / 2) * 2; // tolleranza 2pt
        if (!byY.has(y)) byY.set(y, []);
        byY.get(y).push({ s: it.str, x: it.transform[4], w: it.width || 0 });
      }
      const ys = [...byY.keys()].sort((a, b) => b - a); // dall'alto in basso
      for (const y of ys) lines.push(mergeGlyphs(byY.get(y).sort((a, b) => a.x - b.x)));
      return "";
    },
  });
  const head = lines.slice(0, 40).map((l) => l.map((t) => t.s).join(" ")).join("\n");
  return { format: "pdf", ...parsePdfLines(lines), autoMapping: STD_MAPPING, accountNumber: detectAccountNumber(head) };
}

/**
 * Alcuni PDF (es. estratti trimestrali) hanno un frammento per lettera: unisce
 * i frammenti contigui (gap < 1pt) in una parola, quelli vicini (< 3pt) in una
 * cella separata da spazio; oltre restano celle distinte.
 */
export function mergeGlyphs(items) {
  const out = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    const glyph = it.s.trim().length === 1;
    if (prev && prev.w > 0 && glyph && (prev.g || prev.s.trim().length === 1)) {
      const gap = it.x - (prev.x + prev.w);
      if (gap < 1) { prev.s += it.s; prev.w = it.x + it.w - prev.x; prev.g = true; continue; }
      if (gap < 3) { prev.s += ` ${it.s}`; prev.w = it.x + it.w - prev.x; prev.g = true; continue; }
    }
    out.push({ ...it });
  }
  return out;
}

/** Variante testuale (test / fallback): ogni riga → frammenti separati da spazi. */
export function parsePdfText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      let x = 0;
      return l.split(/\s+/).map((s) => {
        const it = { s, x, w: s.length };
        x += s.length + 1;
        return it;
      });
    });
  return parsePdfLines(lines);
}

/** Spezza i frammenti in token (una cella può contenere più parole). */
function tokens(line) {
  const out = [];
  for (const it of line) {
    const parts = it.s.trim().split(/\s+/).filter(Boolean);
    const step = parts.length > 1 ? (it.w || it.s.length) / it.s.length : 0;
    let off = 0;
    for (const p of parts) {
      out.push({ s: p, x: it.x + off * step });
      off += p.length + 1;
    }
  }
  return out;
}

const DEBIT_HEAD = /^(dare|uscite|addebiti|prelievi|debit)/i;
const CREDIT_HEAD = /^(avere|entrate|accrediti|versamenti|credit)/i;
const BALANCE_HEAD = /^saldo/i;
const nearest = (x, cols) => (Math.abs(x - cols.debitX) <= Math.abs(x - cols.creditX) ? "D" : "C");

export function parsePdfLines(lines) {
  const rows = [STD_HEADERS];
  let current = null;
  let prevBalance = null;
  let cols = null; // { debitX, creditX, balanceX } dall'intestazione tabellare
  let descX = null; // X della colonna descrizione dell'ultimo movimento
  for (const line of lines) {
    const toks = tokens(line);
    if (!toks.length) continue;
    const text = toks.map((t) => t.s).join(" ");
    // Intestazioni con lettere spaziate ("D e s c r i z i o n e"): non sono testo utile.
    if (toks.length >= 6 && toks.filter((t) => t.s.length === 1).length >= toks.length * 0.8) { current = null; continue; }
    let nDates = 0;
    while (nDates < toks.length && DATE_TOKEN.test(toks[nDates].s)) nDates++;
    if (!nDates) {
      // Intestazione colonne → posizioni X di Dare/Avere/Saldo.
      const d = toks.find((t) => DEBIT_HEAD.test(t.s));
      const c = toks.find((t) => CREDIT_HEAD.test(t.s));
      if (d && c) {
        cols = { debitX: d.x, creditX: c.x, balanceX: toks.find((t) => BALANCE_HEAD.test(t.s))?.x ?? null, descX: toks.find((t) => /^descrizione/i.test(t.s))?.x ?? null };
        current = null;
        continue;
      }
      if (/^saldo (iniziale|precedente|al|contabile iniziale)/i.test(text)) {
        const a = toks.filter((t) => AMOUNT_TOKEN.test(t.s));
        if (a.length) prevBalance = toNumber(a[a.length - 1].s);
        current = null;
        continue;
      }
      // Continuazione della descrizione: stessa colonna X del testo del movimento
      // (nei PDF a colonne le righe seguenti possono contenere importi e date).
      const sameCol = current && descX != null && Math.abs(toks[0].x - descX) <= 4;
      const hasAmount = toks.some((t) => AMOUNT_TOKEN.test(t.s));
      const cont = descX != null ? sameCol : !hasAmount;
      if (current && cont && !/^(saldo|totale|pagina|estratto|data|movimenti|pag\.)/i.test(text) && text.length < 120) {
        current[1] = `${current[1]} ${text}`;
      } else if (hasAmount || /^(saldo|totale)/i.test(text)) current = null;
      continue;
    }
    const amounts = toks
      .map((t, i) => ({ ...t, i }))
      .filter((t) => t.i >= nDates && AMOUNT_TOKEN.test(t.s))
      .map((t) => ({ ...t, n: toNumber(t.s) }));
    if (!amounts.length) {
      current = null;
      continue;
    }
    // Descrizione: tra le date e il primo importo; se vuota (layout con la
    // descrizione a destra) le parole dopo l'ultimo importo, tolti simboli e stati.
    let descToks = toks.slice(nDates, amounts[0].i);
    if (!descToks.length) {
      descToks = toks.slice(amounts[amounts.length - 1].i + 1).filter((t) => !/^[€¤Ä]$/.test(t.s) && !/^(contabilizzato|da contabilizzare)$/i.test(t.s));
    }
    const desc = descToks.map((t) => t.s).join(" ");
    if (!/[a-zà-ù]/i.test(desc) && cols?.descX == null) {
      // Data + importo senza testo: riepilogo scalare / tassi, non un movimento.
      current = null;
      continue;
    }
    // Descrizione vuota sulla riga del movimento: può arrivare sulla riga dopo
    // (colonna Descrizione dell'intestazione); se resta vuota la riga cade alla fine.
    descX = descToks.length ? descToks[0].x : cols?.descX ?? null;
    if (/^saldo\b/i.test(desc)) {
      // "SALDO INIZIALE" / "SALDO FINALE": non è un movimento.
      prevBalance = amounts[amounts.length - 1].n;
      current = null;
      continue;
    }
    const explicit = amounts.find((a) => /^[-+]|^\(|-$/.test(a.s));
    let value;
    if (amounts.length === 1) {
      const a = amounts[0];
      value = a.n;
      if (cols && !explicit) {
        const dD = Math.abs(a.x - cols.debitX);
        const dC = Math.abs(a.x - cols.creditX);
        if (cols.balanceX != null && Math.abs(a.x - cols.balanceX) < Math.min(dD, dC)) {
          // Unico importo nella colonna Saldo: riga senza movimento.
          prevBalance = a.n;
          current = null;
          continue;
        }
        value = nearest(a.x, cols) === "D" ? -Math.abs(value) : Math.abs(value);
      }
    } else {
      const last = amounts[amounts.length - 1].n;
      const movement = amounts[0].n;
      if (explicit && explicit !== amounts[amounts.length - 1]) value = explicit.n;
      else if (prevBalance != null && Math.abs(Math.abs(last - prevBalance) - Math.abs(movement)) < 0.011) {
        value = Math.sign(last - prevBalance) * Math.abs(movement); // ultimo = saldo progressivo
      } else if (cols) {
        value = nearest(amounts[0].x, cols) === "D" ? -Math.abs(movement) : Math.abs(movement);
      } else if (amounts.length === 2) {
        value = -Math.abs(movement); // Dare | Avere senza altri indizi: il primo è l'uscita
      } else value = movement;
      prevBalance = last;
    }
    current = [normalizeDate(toks[0].s), desc, value.toFixed(2).replace(".", ",")];
    rows.push(current);
  }
  const out = [rows[0]];
  for (const r of rows.slice(1)) {
    if (!/[a-zà-ù]/i.test(r[1])) continue; // riepilogo scalare / tassi: data + saldo senza testo
    out.push([r[0], cleanDescription(r[1]) || "Movimento", r[2]]);
  }
  return { rows: out };
}

function toNumber(raw) {
  let s = raw.replace(/[()\s€]/g, "");
  const neg = s.startsWith("-") || raw.startsWith("(") || s.endsWith("-");
  s = s.replace(/[-+]/g, "").replace(/\./g, "").replace(",", ".");
  return (neg ? -1 : 1) * Number(s);
}
function normalizeDate(s) {
  const m = s.match(DATE_TOKEN);
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${pad(+m[1])}/${pad(+m[2])}/${y}`;
}
