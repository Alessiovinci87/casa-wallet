// Format a number as EUR currency (it-IT). Separatore delle migliaia SEMPRE,
// anche a 4 cifre (it-IT di default non raggruppa "2670" → "2.670,00 €").
const opts = { style: "currency", currency: "EUR" };
let fmt;
try {
  fmt = new Intl.NumberFormat("it-IT", { ...opts, useGrouping: "always" });
} catch {
  fmt = new Intl.NumberFormat("it-IT", { ...opts, useGrouping: true });
}
export function eur(n) {
  return fmt.format(n || 0);
}
