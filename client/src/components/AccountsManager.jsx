import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { eur } from "../lib/format.js";
import { useAccountStore } from "../store/accountStore.js";
import { useHouseholdStore } from "../store/householdStore.js";

// Gestione dei conti della famiglia: nome, numero (o IBAN, per riconoscere gli
// estratti importati), saldo iniziale alla data, predefinito. Usato in
// Impostazioni e nel Punto zero. `compact` nasconde l'intestazione.
const empty = { name: "", number: "", openingBalance: "", openingBalanceDate: new Date().toISOString().slice(0, 10) };

function AccountForm({ initial, onSave, onCancel, saving }) {
  const [f, setF] = useState(() => ({
    ...empty,
    ...(initial && {
      name: initial.name,
      number: initial.number || "",
      openingBalance: initial.openingBalance ?? "",
      openingBalanceDate: initial.openingBalanceDate ? String(initial.openingBalanceDate).slice(0, 10) : empty.openingBalanceDate,
    }),
  }));
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave({ name: f.name, number: f.number || null, openingBalance: f.openingBalance === "" ? null : Number(f.openingBalance), openingBalanceDate: f.openingBalanceDate }); }}
      className="grid grid-cols-2 gap-2 text-sm"
    >
      <div className="col-span-2">
        <label className="block text-xs text-ink-600 mb-1">Nome del conto</label>
        <input required type="text" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="es. Stipendi, Mutuo" className="w-full px-2 py-2 border border-card-line rounded" />
      </div>
      <div className="col-span-2">
        <label className="block text-xs text-ink-600 mb-1">Numero di conto o IBAN <span className="text-ink-400">(per riconoscere gli estratti)</span></label>
        <input type="text" value={f.number} onChange={(e) => set("number", e.target.value)} placeholder="IT60X0542811101000000123456" className="w-full px-2 py-2 border border-card-line rounded nums" />
      </div>
      <p className="col-span-2 text-[13px] text-ink-400">
        Il saldo iniziale è quello di inizio giornata: i movimenti del giorno scelto e dei giorni dopo si registrano a parte e si sommano. Metti il saldo di ieri sera con la data di oggi, poi registra entrate e uscite di oggi (versamenti compresi).
      </p>
      <div>
        <label className="block text-xs text-ink-600 mb-1">Saldo iniziale €</label>
        <input type="number" step="0.01" value={f.openingBalance} onChange={(e) => set("openingBalance", e.target.value)} placeholder="es. 2500" className="w-full px-2 py-2 border border-card-line rounded nums" />
      </div>
      <div>
        <label className="block text-xs text-ink-600 mb-1">Alla data</label>
        <input type="date" value={f.openingBalanceDate} onChange={(e) => set("openingBalanceDate", e.target.value)} className="w-full px-2 py-2 border border-card-line rounded" />
      </div>
      <div className="col-span-2 flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-3 py-2 text-ink-600">Annulla</button>
        <button type="submit" disabled={saving} className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50">{saving ? "…" : "Salva"}</button>
      </div>
    </form>
  );
}

export default function AccountsManager({ compact = false }) {
  const { accounts, balance, loaded, fetchAccounts, createAccount, updateAccount, removeAccount, reorder } = useAccountStore();
  const move = async (i, dir) => {
    const ids = accounts.map((a) => a.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await reorder(ids); } catch { window.alert("Riordino non riuscito"); }
  };
  const fetchHousehold = useHouseholdStore((s) => s.fetchHousehold);
  const [editing, setEditing] = useState(null); // null | "new" | account
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { fetchAccounts().catch(() => {}); }, [fetchAccounts]);

  const save = async (payload) => {
    setSaving(true);
    setError("");
    try {
      if (editing === "new") await createAccount(payload);
      else await updateAccount(editing.id, payload);
      await fetchHousehold();
      setEditing(null);
    } catch (err) {
      setError(err.response?.data?.error || "Salvataggio non riuscito");
    } finally {
      setSaving(false);
    }
  };
  const remove = async (a) => {
    if (!window.confirm(`Eliminare il conto "${a.name}"? I suoi movimenti passano al conto predefinito.`)) return;
    try { await removeAccount(a.id); await fetchHousehold(); } catch (err) { window.alert(err.response?.data?.error || "Eliminazione non riuscita"); }
  };
  const makeDefault = async (a) => {
    try { await updateAccount(a.id, { isDefault: true }); } catch { window.alert("Operazione non riuscita"); }
  };

  return (
    <div className="space-y-3">
      {!compact && (
        <p className="text-sm text-ink-600">
          Ogni conto parte dal suo saldo iniziale a una data; con il numero di conto o l'IBAN l'app riconosce da sola a quale conto appartiene un estratto importato. L'ordine qui è l'ordine in Home (↑ su / ↓ giù).
        </p>
      )}
      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded p-2">{error}</div>}
      {loaded && accounts.length === 0 && editing !== "new" && (
        <p className="text-sm text-ink-400">Nessun conto: imposta il saldo iniziale oppure aggiungi un conto.</p>
      )}
      <ul className="divide-y divide-card-line">
        {accounts.map((a, i) => (
          <li key={a.id} className="py-2.5">
            {editing && editing !== "new" && editing.id === a.id ? (
              <AccountForm initial={a} onSave={save} onCancel={() => setEditing(null)} saving={saving} />
            ) : (
              <div className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {a.name}
                    {a.isDefault && <span className="ml-2 text-[13px] text-ink-400">predefinito</span>}
                  </div>
                  <div className="text-[13px] text-ink-400">
                    {a.number ? `…${String(a.number).replace(/\s/g, "").slice(-6)} · ` : ""}
                    {a.openingBalance != null ? `punto zero ${eur(a.openingBalance)} al ${dayjs(a.openingBalanceDate).format("DD/MM/YYYY")}` : "senza saldo iniziale"}
                  </div>
                  <div className="flex gap-1 -ml-2 mt-1 text-[13px]">
                    <button type="button" onClick={() => setEditing(a)} className="px-2 text-ink-600 hover:text-brand-600">Modifica</button>
                    {!a.isDefault && <button type="button" onClick={() => makeDefault(a)} className="px-2 text-ink-600 hover:text-brand-600">Rendi predefinito</button>}
                    {accounts.length > 1 && <button type="button" onClick={() => remove(a)} className="px-2 text-ink-600 hover:text-rose-600">Elimina</button>}
                    {accounts.length > 1 && (
                      <>
                        <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-2 text-ink-600 hover:text-brand-600 disabled:opacity-30" aria-label="Sposta su">↑ su</button>
                        <button type="button" onClick={() => move(i, 1)} disabled={i === accounts.length - 1} className="px-2 text-ink-600 hover:text-brand-600 disabled:opacity-30" aria-label="Sposta giù">↓ giù</button>
                      </>
                    )}
                  </div>
                </div>
                <span className="shrink-0 font-semibold nums">{eur(a.balance)}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
      {accounts.length > 1 && (
        <div className="flex justify-between text-sm font-semibold border-t border-card-line pt-2">
          <span>Totale</span><span className="nums">{eur(balance)}</span>
        </div>
      )}
      {editing === "new" ? (
        <AccountForm onSave={save} onCancel={() => setEditing(null)} saving={saving} />
      ) : (
        <button type="button" onClick={() => setEditing("new")} className="px-3 py-2 border border-card-line rounded-lg text-sm text-ink-600 hover:text-brand-600">
          + Aggiungi un conto
        </button>
      )}
    </div>
  );
}
