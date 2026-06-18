// Fixed product-category list used to group receipt items over time.
// The OCR prompt is told to pick exactly one of these; the backend also
// normalizes any unexpected value to "Altro" so analytics never get a
// category invented by the model.
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

const CATEGORY_SET = new Set(PRODUCT_CATEGORIES);

/** Return the category if it is one of the allowed ones, else "Altro". */
export function normalizeCategory(category) {
  return CATEGORY_SET.has(category) ? category : "Altro";
}
