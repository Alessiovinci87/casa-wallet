import dayjs from "dayjs";
import Segmented from "./Segmented.jsx";
import { FREQUENCIES, FREQUENCY_LABELS, WEEKDAY_LABELS } from "../lib/constants.js";

const MONTHS_PER_FREQ = { MONTHLY: 1, BIMONTHLY: 2, QUARTERLY: 3, SEMIANNUAL: 6, YEARLY: 12 };

/** Prime `n` scadenze a partire da startDate con il giorno scelto (31 = ultimo del mese). */
export function previewDates(v, startDate, n = 2) {
  const step = MONTHS_PER_FREQ[v.frequency];
  if (!step || !startDate) return [];
  const start = dayjs(startDate);
  const day = v.dayOfMonth === "" ? start.date() : Number(v.dayOfMonth);
  const out = [];
  for (let k = 0; k < n; k++) {
    const m = start.add(k * step, "month").startOf("month");
    out.push(m.date(Math.min(day, m.daysInMonth())));
  }
  return out;
}

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

const MONTH_NAMES = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

export default function RecurrenceFields({ value, onChange, startDate, amount, onStartDateChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  const weekly = value.frequency === "WEEKLY";
  const step = MONTHS_PER_FREQ[value.frequency] || 1;
  const dates = step > 1 ? previewDates(value, startDate, 2) : [];
  const monthly = step > 1 && Number(amount) > 0 ? Number(amount) / step : null;
  // Mese della prima scadenza (solo periodiche): sposta la data di inizio al primo
  // mese scelto non ancora passato, con il giorno indicato.
  const pickMonth = (m0) => {
    const today = dayjs();
    const day = value.dayOfMonth === "" ? dayjs(startDate || today).date() : Number(value.dayOfMonth);
    let d = today.year(today.year()).month(m0).startOf("month");
    d = d.date(Math.min(day, d.daysInMonth()));
    if (d.isBefore(today, "day")) { d = d.add(1, "year").startOf("month"); d = d.date(Math.min(day, d.daysInMonth())); }
    onStartDateChange?.(d.format("YYYY-MM-DD"));
  };

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
      {step > 1 && onStartDateChange && (
        <div>
          <label className="block text-xs text-ink-600 mb-1">Mese della prima scadenza</label>
          {/* Tendina: 12 mesi sono troppi per i pulsanti; etichette in italiano. */}
          <select
            value={startDate ? dayjs(startDate).month() : ""}
            onChange={(e) => pickMonth(Number(e.target.value))}
            className="w-full px-2 py-2 border border-card-line rounded min-h-[44px]"
          >
            {MONTH_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
        </div>
      )}
      {step > 1 && dates.length > 0 && (
        <p className="text-[13px] text-ink-600 bg-brand-50 rounded-lg p-2">
          Scadenze: <span className="font-medium">{dates.map((d) => d.format("D MMM YYYY")).join(" · ")}</span>, poi ogni {step} mesi.
          {monthly != null && <> Nel Disponibile pesa <span className="font-medium nums">{monthly.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</span> al mese: la quota si accumula fino alla scadenza.</>}
          {" "}Per cambiare le date scegli il mese della prima scadenza e il giorno.
        </p>
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
