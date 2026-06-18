// Predictive shopping list: learns each product's repurchase rhythm from the
// receipt history and flags products that are "due" to be bought again.
//
// Model: per canonicalName, take the sorted list of purchase dates (one per
// day — multiple lines on the same receipt count once), compute the simple
// average interval between consecutive purchases, and predict the next
// purchase as (last purchase + average interval). A product is "due" when
// that predicted date is today or in the past.
import { prisma } from "./prisma.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

/** Whole days between two dates (b - a), can be negative. */
function diffDays(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / MS_PER_DAY;
}

/**
 * Compute the predictive shopping list for a user.
 * @param {string} userId
 * @returns {Promise<Array>} products ordered by urgency (most overdue first)
 */
export async function computeShoppingList(userId) {
  const now = new Date();

  const [items, recurringRows, dismissalRows] = await Promise.all([
    prisma.receiptItem.findMany({
      where: { receipt: { userId } },
      select: {
        canonicalName: true,
        category: true,
        unitPrice: true,
        totalPrice: true,
        quantity: true,
        date: true,
        store: true,
      },
    }),
    prisma.recurringProduct.findMany({ where: { userId } }),
    prisma.shoppingListDismissal.findMany({ where: { userId } }),
  ]);

  const recurringByName = new Map(recurringRows.map((r) => [r.canonicalName, r]));
  const dismissalByName = new Map(dismissalRows.map((d) => [d.canonicalName, d]));

  // Group receipt items by canonicalName.
  const groups = new Map();
  for (const it of items) {
    if (!it.canonicalName) continue;
    if (!groups.has(it.canonicalName)) groups.set(it.canonicalName, []);
    groups.get(it.canonicalName).push(it);
  }

  // Make sure recurring products with no purchase yet still appear.
  for (const name of recurringByName.keys()) {
    if (!groups.has(name)) groups.set(name, []);
  }

  const result = [];

  for (const [canonicalName, groupItems] of groups) {
    const recurring = recurringByName.get(canonicalName);
    const dismissal = dismissalByName.get(canonicalName);

    // One purchase per calendar day (dedupe same-receipt duplicates).
    const byDay = new Map();
    for (const it of groupItems) {
      byDay.set(dayKey(it.date), it); // last write wins; same day → same date anyway
    }
    const uniqueItems = [...byDay.values()].sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );
    const dates = uniqueItems.map((u) => new Date(u.date));
    const timesBought = dates.length;

    const lastItem = uniqueItems[timesBought - 1] || null;
    const lastPurchase = lastItem ? new Date(lastItem.date) : null;
    const lastStore = lastItem ? lastItem.store ?? null : null;
    const category = lastItem ? lastItem.category : recurring ? "Altro" : null;

    // Average price from available unit prices.
    const prices = groupItems.map((i) => i.unitPrice).filter((p) => p != null);
    const avgPrice = prices.length
      ? Number((prices.reduce((s, p) => s + p, 0) / prices.length).toFixed(2))
      : null;

    // Simple average interval between consecutive purchases (needs >= 2).
    let computedInterval = null;
    if (timesBought >= 2) {
      let sum = 0;
      for (let i = 1; i < dates.length; i++) sum += diffDays(dates[i - 1], dates[i]);
      computedInterval = sum / (dates.length - 1);
    }

    // Manual override (intervalDays) wins over the computed average.
    const effectiveInterval =
      recurring && recurring.intervalDays != null ? recurring.intervalDays : computedInterval;

    let predictedNextPurchase = null;
    let daysRemaining = null;
    if (effectiveInterval != null && lastPurchase) {
      predictedNextPurchase = new Date(lastPurchase.getTime() + effectiveInterval * MS_PER_DAY);
      daysRemaining = Math.ceil(diffDays(now, predictedNextPurchase));
    }

    // Due logic.
    let isDue;
    if (effectiveInterval != null && lastPurchase) {
      isDue = daysRemaining <= 0;
    } else if (recurring && recurring.alwaysBuy) {
      // Recurring "always buy" with no usable interval → always surfaced.
      isDue = true;
    } else {
      isDue = false;
    }

    // Dismissal removes the product from the list, but only while it is more
    // recent than the last purchase (rebuying after dismissing re-activates it).
    if (dismissal && lastPurchase && new Date(dismissal.dismissedAt) >= lastPurchase) {
      continue;
    }
    if (dismissal && !lastPurchase) {
      // Dismissed and never bought → keep hidden.
      continue;
    }

    result.push({
      canonicalName,
      category,
      timesBought,
      avgIntervalDays:
        effectiveInterval != null ? Number(effectiveInterval.toFixed(1)) : null,
      lastPurchase,
      predictedNextPurchase,
      daysRemaining,
      isDue,
      isRecurring: !!recurring,
      avgPrice,
      lastStore,
    });
  }

  // Order by urgency: due first, then by daysRemaining ascending (null last).
  result.sort((a, b) => {
    if (a.isDue !== b.isDue) return a.isDue ? -1 : 1;
    const da = a.daysRemaining ?? Infinity;
    const db = b.daysRemaining ?? Infinity;
    return da - db;
  });

  return result;
}
