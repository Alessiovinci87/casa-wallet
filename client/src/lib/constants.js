// Predefined categories used in the transaction form select.
export const CATEGORIES = {
  INCOME: ["Stipendio", "Freelance", "Vendite Amazon", "Rimborso", "Altro"],
  EXPENSE: [
    "Casa", "Spesa", "Ristorante", "Trasporti", "Salute",
    "Abbigliamento", "Bollette", "Tasse", "Svago", "Altro",
  ],
};

export const PAY_METHODS = ["CASH", "POS", "CARD", "TRANSFER"];

export const PAY_METHOD_LABELS = {
  CASH: "Contanti",
  POS: "POS",
  CARD: "Carta",
  TRANSFER: "Bonifico",
};
