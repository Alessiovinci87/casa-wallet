import { useSearchParams } from "react-router-dom";
import Segmented from "../components/Segmented.jsx";
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
  return (
    <div className="space-y-4">
      <Segmented
        value={tab}
        onChange={(v) => setParams({ tab: v })}
        options={TABS}
        className="[&>button]:flex-1 [&>button]:min-h-[44px]"
      />
      {tab === "recurring" ? <RecurringPage embedded /> : <TransactionsPage type={tab === "income" ? "INCOME" : "EXPENSE"} embedded />}
    </div>
  );
}
