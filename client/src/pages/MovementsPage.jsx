import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import Segmented from "../components/Segmented.jsx";
import { useAccountStore } from "../store/accountStore.js";
import TransactionsPage from "./TransactionsPage.jsx";
import RecurringPage from "./RecurringPage.jsx";

// Movimenti: segmented in cima → Uscite · Entrate · Ricorrenze (?tab=).
const TABS = [
  { value: "expenses", label: "Uscite" },
  { value: "income", label: "Entrate" },
  { value: "recurring", label: "Ricorrenze" },
];

export default function MovementsPage({ tab: forced }) {
  const [params, setParams] = useSearchParams();
  const tab = forced || params.get("tab") || "expenses";
  const account = params.get("account") || "";
  const noMerchant = params.get("noMerchant") === "1";
  const initialMonth = params.get("month") ? { month: Number(params.get("month")), year: Number(params.get("year")) } : null;
  const clearNoMerchant = () => setParams(account ? { tab, account } : { tab });
  const accounts = useAccountStore((s) => s.accounts);
  const accountsLoaded = useAccountStore((s) => s.loaded);
  const fetchAccounts = useAccountStore((s) => s.fetchAccounts);
  useEffect(() => { if (!accountsLoaded) fetchAccounts().catch(() => {}); }, [accountsLoaded, fetchAccounts]);
  const setAccount = (id) => setParams(id ? { tab, account: id } : { tab });
  return (
    <div className="space-y-4">
      <Segmented
        value={tab}
        onChange={(v) => setParams(account ? { tab: v, account } : { tab: v })}
        options={TABS}
        className="[&>button]:flex-1 [&>button]:min-h-[44px]"
      />
      {accounts.length > 1 && (
        <Segmented
          size="sm"
          value={account}
          onChange={setAccount}
          options={[{ value: "", label: "Tutti i conti" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
        />
      )}
      {tab === "recurring" ? <RecurringPage embedded accountId={account} /> : <TransactionsPage type={tab === "income" ? "INCOME" : "EXPENSE"} embedded accountId={account} hideAccountFilter noMerchant={noMerchant} onClearNoMerchant={clearNoMerchant} initialMonth={initialMonth} />}
    </div>
  );
}
