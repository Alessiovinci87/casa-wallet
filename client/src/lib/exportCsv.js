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

/**
 * Trigger a browser download of the given transactions as a CSV file.
 * @param {Array} transactions
 * @param {string} [filename]
 */
export function downloadTransactionsCsv(transactions, filename = "transazioni.csv") {
  // BOM so Excel detects UTF-8 (accented categories/descriptions).
  const blob = new Blob(["﻿" + transactionsToCsv(transactions)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
