import Segmented from "./Segmented.jsx";
import { FREQUENCIES, FREQUENCY_LABELS, WEEKDAY_LABELS } from "../lib/constants.js";

// Campi di pianificazione di una ricorrenza (frequenza, giorno, fine, conferma
// manuale). Condivisi tra il toggle "Ripeti" del TransactionForm e la pagina
// Ricorrenze. `value` = { frequency, dayOfMonth, weekday, endDate, autoPost }.
export const emptyRecurrence = {
  frequency: "MONTHLY",
  dayOfMonth: "",
  weekday: "",
  endDate: "",
  autoPost: true,
};

export default function RecurrenceFields({ value, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  const weekly = value.frequency === "WEEKLY";

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-ink-600 mb-1">Frequenza</label>
        <Segmented
          size="sm"
          value={value.frequency}
          onChange={(v) => set("frequency", v)}
          options={FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABELS[f] }))}
        />
      </div>

      {weekly ? (
        <div>
          <label className="block text-xs text-ink-600 mb-1">Giorno della settimana</label>
          <Segmented
            size="sm"
            value={value.weekday === "" ? "" : Number(value.weekday)}
            onChange={(v) => set("weekday", v)}
            options={[
              { value: "", label: "Come la data" },
              ...WEEKDAY_LABELS.map((l, i) => ({ value: i, label: l })),
            ]}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-ink-600 mb-1">Giorno del mese</label>
            <input
              type="number" min="1" max="31" placeholder="Come la data"
              value={value.dayOfMonth}
              onChange={(e) => set("dayOfMonth", e.target.value)}
              className="w-full px-2 py-2 border border-card-line rounded nums"
            />
            <p className="text-[11px] text-ink-400 mt-1">31 = ultimo giorno del mese</p>
          </div>
          <div>
            <label className="block text-xs text-ink-600 mb-1">Fine (opzionale)</label>
            <input
              type="date"
              value={value.endDate}
              onChange={(e) => set("endDate", e.target.value)}
              className="w-full px-2 py-2 border border-card-line rounded"
            />
          </div>
        </div>
      )}
      {weekly && (
        <div>
          <label className="block text-xs text-ink-600 mb-1">Fine (opzionale)</label>
          <input
            type="date"
            value={value.endDate}
            onChange={(e) => set("endDate", e.target.value)}
            className="w-full px-2 py-2 border border-card-line rounded"
          />
        </div>
      )}

      <div>
        <label className="block text-xs text-ink-600 mb-1">Registrazione</label>
        <Segmented
          size="sm"
          value={value.autoPost}
          onChange={(v) => set("autoPost", v)}
          options={[
            { value: true, label: "Automatica" },
            { value: false, label: "Chiedi conferma" },
          ]}
        />
        <p className="text-[11px] text-ink-400 mt-1">
          {value.autoPost
            ? "La transazione nasce da sola alla scadenza."
            : "Alla scadenza ricevi una notifica e confermi importo e data."}
        </p>
      </div>
    </div>
  );
}

/** Converte i campi del form nel payload API (campi vuoti → null). */
export function recurrenceToPayload(v) {
  return {
    frequency: v.frequency,
    dayOfMonth: v.frequency === "WEEKLY" || v.dayOfMonth === "" ? null : Number(v.dayOfMonth),
    weekday: v.frequency !== "WEEKLY" || v.weekday === "" ? null : Number(v.weekday),
    endDate: v.endDate ? new Date(v.endDate).toISOString() : null,
    autoPost: Boolean(v.autoPost),
  };
}
