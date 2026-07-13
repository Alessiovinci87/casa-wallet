import dayjs from "dayjs";
import { PAY_METHOD_LABELS } from "./constants.js";

// Quote a CSV field: wrap in double quotes and escape inner quotes. Use ; as the
// separator (Excel it-IT default) so amounts with a comma decimal don't clash.
function cell(value) {
  const s = value == null ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

const HEADER = ["Data", "Tipo", "Categoria", "Sottocategoria", "Metodo", "Descrizione", "Importo", "Tasse"];

/**
 * Build a CSV string from a list of transactions.
 * @param {Array} transactions
 */
export function transactionsToCsv(transactions) {
  const rows = transactions.map((t) => [
    dayjs(t.date).format("DD/MM/YYYY"),
    t.type === "INCOME" ? "Entrata" : "Uscita",
    t.category,
    t.subcategory || "",
    PAY_METHOD_LABELS[t.method] || t.method,
    t.description || "",
    // it-IT decimals use a comma; keep 2 decimals.
    (t.amount ?? 0).toFixed(2).replace(".", ","),
    t.taxAmount != null ? t.taxAmount.toFixed(2).replace(".", ",") : "",
  ]);

  return [HEADER, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
}

/** Trigger a browser download of a CSV string (BOM so Excel detects UTF-8). */
export function downloadCsv(csv, filename) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Trigger a browser download of the given transactions as a CSV file.
 * @param {Array} transactions
 * @param {string} [filename]
 */
export function downloadTransactionsCsv(transactions, filename = "transazioni.csv") {
  downloadCsv(transactionsToCsv(transactions), filename);
}

const num = (v) => (v ?? 0).toFixed(2).replace(".", ",");

/**
 * CSV del report fiscale annuale (fatture incassate + totali) per il commercialista.
 * @param {{ year, invoices, totals, dueEstimate }} report — shape di GET /api/treasury/fiscal-report
 */
export function fiscalReportToCsv(report) {
  const header = ["Numero", "Data fattura", "Cliente", "P.IVA cliente", "Imponibile", "IVA", "Ritenuta", "Bollo", "Netto", "Data incasso"];
  const rows = report.invoices.map((i) => [
    i.numero,
    dayjs(i.date).format("DD/MM/YYYY"),
    i.customerName,
    i.customerVat || "",
    num(i.imponibile), num(i.iva), num(i.ritenuta), num(i.bollo), num(i.netToPay),
    dayjs(i.collectedAt).format("DD/MM/YYYY"),
  ]);
  const t = report.totals;
  const footer = [
    [],
    ["TOTALI ANNO", report.year],
    ["Fatturato incassato (imponibile)", num(t.fatturatoIncassato)],
    ["IVA incassata", num(t.ivaIncassata)],
    ["Ritenute subite", num(t.ritenuteSubite)],
    ["Netto incassato", num(t.nettoIncassato)],
    ["Accantonato salvadanaio tasse", num(t.accantonato)],
    ["Di cui trasferito", num(t.trasferito)],
  ];
  if (report.dueEstimate) {
    footer.push(
      ["Stima imposta sostitutiva dovuta", num(report.dueEstimate.imposta)],
      ["Stima INPS dovuta", num(report.dueEstimate.inps)],
      ["Stima totale dovuto", num(report.dueEstimate.total)],
    );
  }
  return [header, ...rows, ...footer].map((r) => r.map(cell).join(";")).join("\r\n");
}
