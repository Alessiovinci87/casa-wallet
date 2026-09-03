import { useEffect, useState } from "react";
import { useAuthStore } from "../store/authStore.js";
import { useHouseholdStore } from "../store/householdStore.js";

// Impostazioni famiglia: nome (editabile dall'OWNER), membri, codice invito
// con copia + rigenerazione (OWNER), logout.
export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { household, loading, fetchHousehold, rename, regenerateInvite, setOpeningBalance } = useHouseholdStore();
  // Punto zero del saldo effettivo.
  const [opening, setOpening] = useState({ amount: "", date: new Date().toISOString().slice(0, 10) });
  const [openingSaving, setOpeningSaving] = useState(false);
  const [openingMsg, setOpeningMsg] = useState("");

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const isOwner = user?.role === "OWNER";

  useEffect(() => {
    fetchHousehold();
  }, [fetchHousehold]);

  useEffect(() => {
    if (household) {
      setName(household.name);
      setOpening({
        amount: household.openingBalance ?? "",
        date: household.openingBalanceDate ? String(household.openingBalanceDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
      });
    }
  }, [household]);

  const saveOpening = async (e) => {
    e.preventDefault();
    setOpeningSaving(true);
    setOpeningMsg("");
    try {
      await setOpeningBalance(opening.amount === "" ? null : Number(opening.amount), opening.date);
      setOpeningMsg("Salvato ✓");
    } catch (err) {
      setOpeningMsg(err.response?.data?.error || "Errore nel salvataggio");
    } finally {
      setOpeningSaving(false);
    }
  };

  const handleRename = async (e) => {
    e.preventDefault();
    if (!name.trim() || name.trim() === household?.name) return;
    setSaving(true);
    setError("");
    try {
      await rename(name.trim());
    } catch (err) {
      setError(err.response?.data?.error || "Errore nel salvataggio");
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!household?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(household.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard non disponibile (http non sicuro): nessun feedback
    }
  };

  const handleRegenerate = async () => {
    if (!window.confirm("Rigenerare il codice invito? Il codice attuale smetterà di funzionare."))
      return;
    setError("");
    try {
      await regenerateInvite();
    } catch (err) {
      setError(err.response?.data?.error || "Errore nella rigenerazione");
    }
  };

  if (loading && !household) {
    return <div className="p-6 text-ink-600">Caricamento…</div>;
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-xl font-bold text-ink-900">Impostazioni</h1>

      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded p-2">{error}</div>}

      {/* Famiglia */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink-600 uppercase tracking-wide mb-3">
          Famiglia
        </h2>
        {isOwner ? (
          <form onSubmit={handleRename} className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 px-3 py-2 border border-card-line rounded focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
            <button
              type="submit"
              disabled={saving || !name.trim() || name.trim() === household?.name}
              className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "…" : "Salva"}
            </button>
          </form>
        ) : (
          <p className="text-lg font-medium text-ink-900">{household?.name}</p>
        )}
      </section>

      {/* Punto zero: saldo iniziale */}
      <section className="card p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-ink-600 uppercase tracking-wide">
            Saldo iniziale (punto zero)
          </h2>
          <a href="/onboarding" className="text-xs text-brand-600 hover:underline">Apri la procedura guidata</a>
        </div>
        <p className="text-sm text-ink-600 mb-3">
          Il saldo effettivo parte da qui: saldo del conto a una data + entrate − uscite registrate da quel giorno.
          Senza punto zero il saldo è la somma di tutte le transazioni.
        </p>
        <form onSubmit={saveOpening} className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-xs text-ink-600 mb-1">Saldo €</label>
            <input
              type="number" step="0.01"
              value={opening.amount}
              onChange={(e) => setOpening((o) => ({ ...o, amount: e.target.value }))}
              placeholder="es. 2500"
              className="w-36 px-3 py-2 border border-card-line rounded nums"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-600 mb-1">Alla data</label>
            <input
              type="date"
              value={opening.date}
              onChange={(e) => setOpening((o) => ({ ...o, date: e.target.value }))}
              className="px-3 py-2 border border-card-line rounded"
            />
          </div>
          <button type="submit" disabled={openingSaving} className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50">
            {openingSaving ? "…" : "Salva"}
          </button>
          {household?.openingBalance != null && (
            <button
              type="button"
              onClick={() => { setOpening((o) => ({ ...o, amount: "" })); setOpeningBalance(null).catch(() => {}); }}
              className="px-3 py-2 text-sm text-ink-600 hover:text-rose-600"
            >
              Rimuovi
            </button>
          )}
          {openingMsg && <span className="text-sm text-ink-600 self-center">{openingMsg}</span>}
        </form>
      </section>

      {/* Codice invito */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink-600 uppercase tracking-wide mb-1">
          Codice invito
        </h2>
        <p className="text-sm text-ink-600 mb-3">
          Condividilo con chi vuoi far entrare nella famiglia: lo inserirà in fase di
          registrazione.
        </p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-lg tracking-widest bg-paper rounded px-3 py-2 nums">
            {household?.inviteCode}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="px-3 py-2 text-sm bg-paper rounded hover:bg-brand-50"
          >
            {copied ? "Copiato ✓" : "Copia"}
          </button>
          {isOwner && (
            <button
              type="button"
              onClick={handleRegenerate}
              className="px-3 py-2 text-sm text-rose-600 bg-rose-50 rounded hover:bg-rose-100"
            >
              Rigenera
            </button>
          )}
        </div>
      </section>

      {/* Membri */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink-600 uppercase tracking-wide mb-3">
          Membri
        </h2>
        <ul className="divide-y divide-card-line">
          {household?.members?.map((m) => (
            <li key={m.id} className="py-2 flex items-center justify-between">
              <div>
                <span className="font-medium text-ink-900">{m.name}</span>
                {m.id === user?.id && <span className="text-ink-400"> (tu)</span>}
                <div className="text-sm text-ink-600">{m.email}</div>
              </div>
              <span
                className={`text-xs px-2 py-1 rounded-full ${
                  m.role === "OWNER"
                    ? "bg-brand-50 text-brand-700"
                    : "bg-paper text-ink-600"
                }`}
              >
                {m.role === "OWNER" ? "Proprietario" : "Membro"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Account */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink-600 uppercase tracking-wide mb-3">
          Account
        </h2>
        <p className="text-sm text-ink-600 mb-3">
          Connesso come <strong>{user?.name}</strong> ({user?.email})
        </p>
        <button
          type="button"
          onClick={logout}
          className="px-4 py-2 text-sm text-rose-600 bg-rose-50 rounded hover:bg-rose-100"
        >
          Esci
        </button>
      </section>
    </div>
  );
}
