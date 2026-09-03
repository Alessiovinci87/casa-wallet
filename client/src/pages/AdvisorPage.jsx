import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import api from "../lib/api.js";
import { eur } from "../lib/format.js";
import Segmented from "../components/Segmented.jsx";

// Consulente: capacità mensile (entrate − fisse − variabili), verdetto su ogni
// obiettivo con le alternative (sposta la data / taglia / entrate extra), quote
// saltate, dove tagliare con il risparmio, e il resoconto da copiare, condividere
// o stampare in PDF (anche per farlo leggere a un assistente).

const LEVEL = {
  ok: "border-brand-200 bg-brand-50 text-brand-800",
  info: "border-card-line bg-white text-ink-900",
  warn: "border-tax-600/30 bg-tax-50/60 text-tax-700",
  bad: "border-rose-200 bg-rose-50 text-rose-700",
};
const VERDICT = {
  OK: { label: "Sostenibile", cls: "bg-brand-50 text-brand-700" },
  TIGHT: { label: "Difficile", cls: "bg-tax-50 text-tax-600" },
  NO: { label: "Non sostenibile ora", cls: "bg-rose-50 text-rose-700" },
};

function Row({ label, value, strong, tone }) {
  return (
    <div className={`flex justify-between gap-3 py-1.5 ${strong ? "font-semibold" : ""}`}>
      <span className="text-ink-600">{label}</span>
      <span className={`nums ${tone || ""}`}>{value}</span>
    </div>
  );
}

export default function AdvisorPage() {
  const navigate = useNavigate();
  const [months, setMonths] = useState(3);
  const [r, setR] = useState(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  const [picked, setPicked] = useState({}); // tagli selezionati → risparmio cumulato

  useEffect(() => {
    setR(null);
    api.get("/api/advisor/report", { params: { months } }).then(({ data }) => setR(data)).catch(() => setErr("Resoconto non disponibile"));
  }, [months]);

  const share = async () => {
    if (!r) return;
    const text = r.text;
    try {
      if (navigator.share) { await navigator.share({ title: "Resoconto Awareness", text }); return; }
    } catch { /* annullato */ }
    try { await navigator.clipboard.writeText(text); setCopied("Copiato negli appunti: incollalo dove vuoi (anche in una chat con l'assistente)."); setTimeout(() => setCopied(""), 4000); } catch { setCopied("Copia non riuscita"); }
  };
  const pickedTotal = r ? r.cuts.filter((c) => picked[c.label]).reduce((s, c) => s + c.saving, 0) : 0;

  if (err) return <p className="text-sm text-rose-600">{err}</p>;
  if (!r) return <p className="text-sm text-ink-400">Sto leggendo entrate, spese e obiettivi…</p>;
  const c = r.capacity;

  return (
    <div className="space-y-4 print:space-y-3">
      <h1 className="sr-only">Consulente</h1>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Segmented size="sm" value={months} onChange={setMonths} options={[{ value: 1, label: "Questo mese" }, { value: 3, label: "3 mesi" }, { value: 6, label: "6 mesi" }, { value: 12, label: "12 mesi" }]} />
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={share} className="min-h-[44px] px-3 rounded-lg border border-card-line text-[13px] text-ink-600">Condividi / copia</button>
          <button type="button" onClick={() => window.print()} className="min-h-[44px] px-3 rounded-lg border border-card-line text-[13px] text-ink-600">PDF</button>
        </div>
      </div>
      {copied && <div className="text-[13px] text-brand-700 bg-brand-50 rounded-lg p-2 print:hidden">{copied}</div>}
      <p className="text-[13px] text-ink-400">Periodo: {r.period.label}{r.period.shortHistory ? " · storico breve, stime dalle ricorrenze" : ""}</p>

      {/* Messaggi principali */}
      <div className="space-y-2">
        {r.messages.map((m, i) => (
          <div key={i} className={`rounded-xl border p-3 ${LEVEL[m.level]}`}>
            <div className="font-semibold text-sm">{m.title}</div>
            <div className="text-sm mt-0.5">{m.text}</div>
          </div>
        ))}
      </div>

      {/* Capacità */}
      <section className="card p-4">
        <h2 className="font-semibold mb-1">Quanto puoi mettere da parte ogni mese</h2>
        <Row label={`Entrate attese (${c.incomeSource})`} value={eur(c.expectedIncome)} tone="text-brand-600" />
        <Row label="Spese fisse (ricorrenze)" value={`− ${eur(c.fixedMonthly)}`} />
        <Row label="Spese variabili (media)" value={`− ${eur(c.variableMonthly)}`} />
        <div className="border-t border-card-line" />
        <Row label="Margine libero" value={eur(c.free)} strong tone={c.free < 0 ? "text-rose-600" : ""} />
        <Row label="Quote degli obiettivi" value={`− ${eur(c.goalsQuota)}`} />
        <Row label="Resta dopo gli obiettivi" value={eur(c.margin)} strong tone={c.margin < 0 ? "text-rose-600" : "text-brand-700"} />
        {r.monthly.length > 0 && (
          <div className="mt-3 text-[13px] text-ink-400">
            {r.monthly.map((m) => <div key={m.month} className="flex justify-between"><span>{dayjs(m.month + "-01").format("MMM YYYY")}</span><span className="nums">+{eur(m.income)} · −{eur(m.expense)}</span></div>)}
          </div>
        )}
      </section>

      {/* Obiettivi */}
      <section className="card p-4 space-y-3">
        <h2 className="font-semibold">Obiettivi: si possono raggiungere?</h2>
        {r.goals.length === 0 && <p className="text-sm text-ink-400">Nessun obiettivo attivo. <button type="button" onClick={() => navigate("/goals")} className="underline text-brand-600">Creane uno</button> e qui ti dico se è sostenibile.</p>}
        {r.goals.map((g) => (
          <div key={g.id} className="border border-card-line rounded-xl p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium">{g.icon} {g.name}</div>
              <span className={`text-[13px] px-2 py-0.5 rounded-full ${VERDICT[g.verdict].cls}`}>{VERDICT[g.verdict].label}</span>
            </div>
            <div className="text-[13px] text-ink-400 nums">{eur(g.saved)} su {eur(g.target)}{g.dueDate ? ` · entro ${dayjs(g.dueDate).format("D MMM YYYY")}` : ""}{g.quota ? ` · quota ${eur(g.quota)}/mese` : ""}</div>
            <p className="text-sm mt-1">{g.text}</p>
            {g.alerts.map((a, i) => <p key={i} className="text-sm text-rose-600 mt-1">⚠ {a}</p>)}
            {g.options.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm">
                {g.options.map((o, i) => <li key={i} className="flex gap-2"><span className="text-brand-600">›</span><span>{o.text}</span></li>)}
              </ul>
            )}
          </div>
        ))}
      </section>

      {/* Tagli */}
      <section className="card p-4">
        <h2 className="font-semibold">Dove tagliare</h2>
        <p className="text-[13px] text-ink-400 mb-2">Le voci variabili più pesanti, escluse quelle necessarie. Spunta quelle su cui te la senti: sotto vedi quanto liberi.</p>
        {r.cuts.length === 0 && <p className="text-sm text-ink-400">Poche spese variabili registrate: usa il tasto + con Dove e Cosa, e qui compariranno proposte precise.</p>}
        <ul className="divide-y divide-card-line">
          {r.cuts.map((k) => (
            <li key={k.label} className="py-2 flex items-center gap-3">
              <input type="checkbox" checked={Boolean(picked[k.label])} onChange={(e) => setPicked((p) => ({ ...p, [k.label]: e.target.checked }))} className="w-5 h-5 print:hidden" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{k.label} <span className="text-ink-400 font-normal">· {k.category}</span></div>
                <div className="text-[13px] text-ink-400 nums">{eur(k.monthly)}/mese, {k.count}× → proposta: −{Math.round(k.share * 100)}%</div>
              </div>
              <span className="shrink-0 nums font-semibold text-brand-700">+{eur(k.saving)}/mese</span>
            </li>
          ))}
        </ul>
        {r.cuts.length > 0 && (
          <div className="mt-2 text-sm flex justify-between font-semibold border-t border-card-line pt-2">
            <span>{pickedTotal > 0 ? "Con le voci spuntate liberi" : "Con tutte le proposte liberi"}</span>
            <span className="nums text-brand-700">{eur(pickedTotal > 0 ? pickedTotal : r.cutsTotal)}/mese · {eur((pickedTotal > 0 ? pickedTotal : r.cutsTotal) * 12)}/anno</span>
          </div>
        )}
        {r.smallSubs.length > 0 && (
          <p className="text-[13px] text-ink-600 mt-3">Abbonamenti piccoli: {r.smallSubs.map((s) => `${s.description} ${eur(s.monthly)}`).join(", ")} = <span className="nums font-semibold">{eur(r.smallSubsTotal)}/mese</span>. Disdirne uno è il taglio più facile.</p>
        )}
      </section>

      <p className="text-[13px] text-ink-400 print:hidden">
        Ogni 1° di gennaio, aprile, luglio e ottobre ricevi una notifica con questo resoconto. "Condividi / copia" ti dà il testo completo: incollalo in una chat con l'assistente per farti aiutare a rivedere abitudini e impostazioni.
      </p>
    </div>
  );
}
