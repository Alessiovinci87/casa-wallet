// Conti bancari della famiglia. Il saldo effettivo è la somma dei conti; ogni
// conto ha il suo punto zero (openingBalance alla data). Le transazioni senza
// accountId appartengono al conto predefinito. Famiglie nate prima dei conti:
// `ensureAccounts` crea il conto predefinito dal punto zero della famiglia.
import { prisma } from "./prisma.js";
import { todayRomeUTC } from "./recurrence.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const round2 = (n) => Number((Math.round(n * 100) / 100).toFixed(2));

/** Solo cifre, senza zeri iniziali: "IT13R0101584899000070413523" → "13010158489900007..." ; "000070413523" → "70413523". */
export function normalizeAccountNumber(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.replace(/^0+/, "");
}

/** Il conto il cui numero (o IBAN) termina con le cifre trovate nell'estratto, o viceversa. */
export function matchAccount(accounts, detectedNumber) {
  const d = normalizeAccountNumber(detectedNumber);
  if (!d || d.length < 5) return null;
  for (const a of accounts) {
    const n = normalizeAccountNumber(a.number);
    if (!n) continue;
    if (n === d || n.endsWith(d) || d.endsWith(n)) return a;
  }
  return null;
}

/** Conti della famiglia; crea il predefinito dal punto zero se non ne esiste nessuno. */
export async function ensureAccounts(householdId) {
  let accounts = await prisma.bankAccount.findMany({ where: { householdId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  if (accounts.length === 0) {
    const hh = await prisma.household.findUnique({ where: { id: householdId }, select: { openingBalance: true, openingBalanceDate: true } });
    if (hh?.openingBalance != null) {
      const a = await prisma.bankAccount.create({
        data: { householdId, name: "Conto principale", openingBalance: hh.openingBalance, openingBalanceDate: hh.openingBalanceDate, isDefault: true },
      });
      accounts = [a];
    }
  } else if (!accounts.some((a) => a.isDefault)) {
    await prisma.bankAccount.update({ where: { id: accounts[0].id }, data: { isDefault: true } });
    accounts[0].isDefault = true;
  }
  return accounts;
}

export async function defaultAccountId(householdId) {
  const accounts = await ensureAccounts(householdId);
  return accounts.find((a) => a.isDefault)?.id ?? null;
}

/** Saldo di un conto: opening + Σ entrate − Σ uscite dalla data di apertura a oggi incluso. */
async function accountBalance(householdId, account, isDefault, today) {
  const endOfToday = new Date(today.getTime() + MS_PER_DAY - 1);
  const where = { householdId, date: { lte: endOfToday } };
  // Il predefinito raccoglie anche le transazioni senza conto.
  if (isDefault) where.OR = [{ accountId: account.id }, { accountId: null }];
  else where.accountId = account.id;
  if (account.openingBalanceDate) where.date.gte = account.openingBalanceDate;
  const [inc, exp] = await Promise.all([
    prisma.transaction.aggregate({ where: { ...where, type: "INCOME" }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { ...where, type: "EXPENSE" }, _sum: { amount: true } }),
  ]);
  const income = inc._sum.amount || 0;
  const expense = exp._sum.amount || 0;
  const opening = account.openingBalance ?? 0;
  return { income: round2(income), expense: round2(expense), opening, balance: round2(opening + income - expense) };
}

/**
 * Saldi per conto e totale. Ritorna { accounts: [{id, name, number, isDefault,
 * openingBalance, openingBalanceDate, balance}], balance, income, expense, opening,
 * hasOpeningBalance }. Senza conti (nessun punto zero) somma tutte le transazioni.
 */
export async function computeAccountBalances(householdId, today = todayRomeUTC()) {
  const accounts = await ensureAccounts(householdId);
  if (accounts.length === 0) {
    const endOfToday = new Date(today.getTime() + MS_PER_DAY - 1);
    const where = { householdId, date: { lte: endOfToday } };
    const [inc, exp] = await Promise.all([
      prisma.transaction.aggregate({ where: { ...where, type: "INCOME" }, _sum: { amount: true } }),
      prisma.transaction.aggregate({ where: { ...where, type: "EXPENSE" }, _sum: { amount: true } }),
    ]);
    const income = round2(inc._sum.amount || 0);
    const expense = round2(exp._sum.amount || 0);
    return { accounts: [], balance: round2(income - expense), income, expense, opening: 0, hasOpeningBalance: false };
  }
  const rows = await Promise.all(accounts.map((a) => accountBalance(householdId, a, a.isDefault, today)));
  const out = accounts.map((a, i) => ({
    id: a.id, name: a.name, number: a.number, isDefault: a.isDefault,
    openingBalance: a.openingBalance, openingBalanceDate: a.openingBalanceDate,
    balance: rows[i].balance, income: rows[i].income, expense: rows[i].expense,
  }));
  const sum = (k) => round2(rows.reduce((s, r) => s + r[k], 0));
  return { accounts: out, balance: sum("balance"), income: sum("income"), expense: sum("expense"), opening: sum("opening"), hasOpeningBalance: true };
}

/** Valida un accountId del body: deve appartenere alla famiglia (null/undefined → conto predefinito). */
export async function resolveAccountId(householdId, accountId) {
  if (!accountId) return null;
  const a = await prisma.bankAccount.findFirst({ where: { id: String(accountId), householdId }, select: { id: true } });
  if (!a) throw Object.assign(new Error("Conto non trovato"), { status: 400 });
  return a.id;
}
