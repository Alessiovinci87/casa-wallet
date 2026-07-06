// Predefined categories used in the transaction form select.
export const CATEGORIES = {
  INCOME: ["Stipendio", "Freelance", "Fatture", "Vendite Amazon", "Rimborso", "Altro"],
  EXPENSE: [
    "Casa", "Spesa", "Ristorante", "Trasporti", "Salute",
    "Abbigliamento", "Bollette", "Tasse", "Svago", "Altro",
  ],
};

// Fixed product categories for receipt items (must match the server list).
export const PRODUCT_CATEGORIES = [
  "Frutta e verdura",
  "Carne e pesce",
  "Latticini e uova",
  "Pane e cereali",
  "Bevande",
  "Surgelati",
  "Dispensa",
  "Snack e dolci",
  "Cura casa",
  "Cura persona",
  "Altro",
];

export const PAY_METHODS = ["CASH", "POS", "CARD", "TRANSFER"];

export const PAY_METHOD_LABELS = {
  CASH: "Contanti",
  POS: "POS",
  CARD: "Carta",
  TRANSFER: "Bonifico",
};
