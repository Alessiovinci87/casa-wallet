import { useEffect } from "react";
import Segmented from "./Segmented.jsx";
import { useAccountStore } from "../store/accountStore.js";

// Scelta del conto (Stipendi / Mutuo…). Non compare se la famiglia ha un solo conto.
// `value` = accountId ("" = predefinito). Chiama onChange col predefinito al primo
// caricamento se value è vuoto, così il payload porta sempre un conto esplicito.
export default function AccountPicker({ value, onChange, label = "Conto", size = "sm" }) {
  const { accounts, loaded, fetchAccounts } = useAccountStore();
  useEffect(() => { if (!loaded) fetchAccounts().catch(() => {}); }, [loaded, fetchAccounts]);
  useEffect(() => {
    if (!value && accounts.length) {
      const def = accounts.find((a) => a.isDefault) || accounts[0];
      onChange(def.id);
    }
  }, [accounts, value, onChange]);
  if (accounts.length < 2) return null;
  return (
    <div>
      <label className="block text-xs text-ink-600 mb-1">{label}</label>
      <Segmented size={size} value={value || ""} onChange={onChange} options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
    </div>
  );
}
