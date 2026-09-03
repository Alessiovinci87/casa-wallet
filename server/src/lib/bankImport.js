// Import estratto conto CSV: parser tollerante (le banche italiane esportano
// formati eterogenei), normalizzazione importi/date, dedupe via hash,
// categorizzazione a regole (keyword) e rilevamento ricorrenze.
import { createHash } from "node:crypto";

/** Rileva il delimitatore sulla prima riga non vuota. */
export function detectDelimiter(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim()) || "";
  const counts = [";", ",", "\t", "|"].map((d) => [d, (line.match(new RegExp(d === "|" ? "\\|" : d, "g")) || []).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ";";
}

/** Parser CSV con campi tra virgolette (RFC-4180-ish). Ritorna array di array. */
export function parseCsv(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

/** "1.234,56" | "-12,30" | "12.30" | "€ 1 234,56" | "(12,00)" → numero. */
export function parseAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[€\s]/g, "");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else if (lastDot > lastComma) s = s.replace(/,/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, yyyy-mm-dd, dd/mm/yy → Date UTC mezzanotte. */
export function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return new Date(Date.UTC(y, +m[2] - 1, +m[1]));
  }
  return null;
}

export function normalizeDescription(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\d{2,}/g, " ") // numeri (date, importi, riferimenti) fuori dalla chiave
    .replace(/[^a-z0-9àèéìòù ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function importHash({ date, amount, description }) {
  const key = `${date.toISOString().slice(0, 10)}|${Number(amount).toFixed(2)}|${normalizeDescription(description)}`;
  return createHash("sha1").update(key).digest("hex");
}

/**
 * Applica il mapping alle righe grezze. mapping: { dateCol, amountCol?, debitCol?,
 * creditCol?, descCol, hasHeader=true, invertSign=false }. Le colonne sono indici.
 */
export function applyMapping(rows, mapping) {
  const start = mapping.hasHeader === false ? 0 : 1;
  const out = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const date = parseDate(r[mapping.dateCol]);
    let amount = null;
    if (mapping.amountCol != null && mapping.amountCol !== "") amount = parseAmount(r[mapping.amountCol]);
    else {
      const debit = parseAmount(r[mapping.debitCol]);
      const credit = parseAmount(r[mapping.creditCol]);
      if (debit != null && debit !== 0) amount = -Math.abs(debit);
      else if (credit != null && credit !== 0) amount = Math.abs(credit);
    }
    if (mapping.invertSign && amount != null) amount = -amount;
    const description = String(r[mapping.descCol] ?? "").trim();
    if (!date || amount == null || amount === 0) {
      out.push({ line: i + 1, error: !date ? "data non riconosciuta" : "importo non riconosciuto", raw: r });
      continue;
    }
    out.push({
      line: i + 1,
      date,
      amount: Math.abs(amount),
      type: amount < 0 ? "EXPENSE" : "INCOME",
      description,
      hash: importHash({ date, amount, description }),
    });
  }
  return out;
}

/** Categoria dalle regole (prima che matcha, pattern più lungo prima). */
export function categorize(description, rules, type) {
  const d = String(description || "").toLowerCase();
  const sorted = [...rules].sort((a, b) => b.pattern.length - a.pattern.length);
  for (const r of sorted) {
    if (r.type && r.type !== type) continue;
    if (d.includes(r.pattern.toLowerCase())) return r.category;
  }
  return null;
}

// Fallback keyword → categoria (italiano, niente AI).
const DEFAULT_KEYWORDS = [
  [/(conad|coop|esselunga|carrefour|lidl|eurospin|md |pam |supermerc|iper)/, "Spesa"],
  [/(farmac|medic|ospedal|dott)/, "Salute"],
  [/(benzin|carbur|eni |q8|esso|ip |autostrad|telepass|treno|trenitalia|italo|atm |atac|bus)/, "Trasporti"],
  [/(enel|eni gas|a2a|hera|iren|acea|luce|gas|acqua|tim |vodafone|wind|iliad|fastweb|internet|telefon)/, "Bollette"],
  [/(affitto|mutuo|condomin|canone)/, "Casa"],
  [/(ristor|pizz|trattor|bar |caff|deliveroo|glovo|just eat)/, "Ristorante"],
  [/(zara|h&m|decathlon|abbigl|scarpe)/, "Abbigliamento"],
  [/(netflix|spotify|cinema|amazon prime|disney|dazn|palestra|gym)/, "Svago"],
  [/(f24|agenzia entrate|inps|imposta|tributi)/, "Tasse"],
  [/(stipendio|emolument|salary)/, "Stipendio"],
  [/(fattura|bonifico a favore|accredito)/, "Fatture"],
];
export function guessCategory(description, type) {
  const d = String(description || "").toLowerCase();
  for (const [re, cat] of DEFAULT_KEYWORDS) {
    if (re.test(d)) {
      if (type === "INCOME" && !["Stipendio", "Fatture"].includes(cat)) continue;
      if (type === "EXPENSE" && ["Stipendio", "Fatture"].includes(cat)) continue;
      return cat;
    }
  }
  return null;
}

/** Mediana di un array numerico. */
function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Rileva ricorrenze: raggruppa per descrizione normalizzata; nel gruppo,
 * importi entro ±2% della mediana e giorno del mese entro ±3 della mediana,
 * in ≥ minMonths mesi distinti → proposta.
 */
export function detectRecurrences(transactions, { minMonths = 3 } = {}) {
  const groups = new Map();
  for (const t of transactions) {
    const key = `${t.type}|${normalizeDescription(t.description)}`;
    if (!normalizeDescription(t.description)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const proposals = [];
  for (const [, items] of groups) {
    if (items.length < minMonths) continue;
    const amounts = items.map((t) => t.amount);
    const medAmount = median(amounts);
    const days = items.map((t) => new Date(t.date).getUTCDate());
    const medDay = Math.round(median(days));
    const matching = items.filter(
      (t) =>
        Math.abs(t.amount - medAmount) <= medAmount * 0.02 + 0.01 &&
        Math.abs(new Date(t.date).getUTCDate() - medDay) <= 3
    );
    const months = new Set(matching.map((t) => new Date(t.date).toISOString().slice(0, 7)));
    if (months.size < minMonths) continue;
    const sorted = [...matching].sort((a, b) => new Date(b.date) - new Date(a.date));
    const last = sorted[0];
    proposals.push({
      description: last.description,
      type: last.type,
      category: last.category || null,
      amount: Number(medAmount.toFixed(2)),
      dayOfMonth: medDay,
      months: months.size,
      lastDate: last.date,
      sampleIds: sorted.slice(0, 6).map((t) => t.id).filter(Boolean),
    });
  }
  proposals.sort((a, b) => b.months - a.months || b.amount - a.amount);
  return proposals;
}
