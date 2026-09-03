import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import { useTransactionStore } from "../store/transactionStore.js";
import { useAuthStore } from "../store/authStore.js";
import { useGoalStore } from "../store/goalStore.js";
import { useRecurringStore } from "../store/recurringStore.js";
import api from "../lib/api.js";
import { eur } from "../lib/format.js";
import NotificationsToggle from "../components/NotificationsToggle.jsx";
import { ChevronIcon, XIcon } from "../components/Icons.jsx";

// Dashboard a tre livelli (A2):
//  1. Disponibile reale — unico numero grande, tap → sheet con il breakdown
//  2. Tre card compatte: Obiettivi · In arrivo · Prossima scadenza
//  3. "Il mese" comprimibile: entrate/uscite vs mese precedente, previsione, grafico
const BalanceTrendChart = lazy(() => import("../components/BalanceTrendChart.jsx"));

const now = new Date();
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();
const MONTH_NAME = new Intl.DateTimeFormat("it-IT", { month: "long" }).format(now);
const prevDate = new Date(YEAR, MONTH - 2, 1);

function pctChange(curr, prev) {
  if (!prev) return curr ? null : 0;
  return ((curr - prev) / prev) * 100;
}

function Delta({ value, goodWhenUp }) {
  if (value == null) return <span className="text-ink-400">n.d.</span>;
  const flat = Math.abs(value) < 0.5;
  const up = value > 0;
  const color = flat ? "text-ink-400" : up === goodWhenUp ? "text-brand-600" : "text-rose-600";
  return <span className={`${color} font-medium nums`}>{flat ? "→" : up ? "▲" : "▼"} {Math.abs(value).toFixed(0)}%</span>;
}

// Card compatta: un solo numero, tap per il dettaglio.
function MiniCard({ label, value, sub, tone = "text-ink-900", onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card p-3.5 text-left min-w-[11rem] snap-start shrink-0 sm:min-w-0 sm:flex-1 hover:border-brand-200 transition min-h-[88px]"
    >
      <div className="text-[13px] text-ink-600">{label}</div>
      <div className={`text-xl font-bold nums mt-0.5 ${tone}`}>{value}</div>
      {sub && <div className="text-[13px] text-ink-400 mt-0.5 truncate">{sub}</div>}
    </button>
  );
}

function BreakdownSheet({ avail, onClose }) {
  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="absolute inset-x-0 bottom-0 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[28rem] bg-white rounded-t-2xl md:rounded-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Come si calcola il Disponibile reale"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Disponibile reale</h2>
          <button onClick={onClose} className="p-2 -mr-2 text-ink-400" aria-label="Chiudi"><XIcon size={20} /></button>
        </div>
        <ul className="divide-y divide-card-line text-[15px]">
          {avail.breakdown.map((b) => (
            <li key={b.key} className="py-2.5">
              <div className="flex justify-between gap-3">
                <span className="text-ink-600">{b.label}</span>
                <span className="font-semibold nums">{b.sign < 0 ? "− " : ""}{eur(b.amount)}</span>
              </div>
              {b.key === "balance" && avail.accounts?.length > 1 && (
                <ul className="mt-1 text-[13px] text-ink-400">
                  {avail.accounts.map((a) => (
                    <li key={a.id} className="flex justify-between"><span>{a.name}</span><span className="nums">{eur(a.balance)}</span></li>
                  ))}
                </ul>
              )}
              {b.key === "periodic" && avail.periodicItems?.length > 0 && (
                <ul className="mt-1 text-[13px] text-ink-400">
                  {avail.periodicItems.map((i) => (
                    <li key={i.ruleId} className="flex justify-between gap-2"><span className="truncate">{i.description} · {eur(i.monthlyEquivalent)}/mese</span><span className="nums shrink-0">{eur(i.accrued)}</span></li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          <li className="py-2.5 flex justify-between gap-3 font-bold">
            <span>Disponibile reale</span>
            <span className={`nums ${avail.available < 0 ? "text-rose-600" : ""}`}>{eur(avail.available)}</span>
          </li>
        </ul>
        {avail.committedItems.length > 0 && (
          <p className="text-[13px] text-ink-400 mt-3">
            Fisse in arrivo entro fine mese: {avail.committedItems.map((i) => `${i.description} il ${dayjs(i.date).format("D/M")} (${eur(i.amount)})`).join(", ")}.
          </p>
        )}
        {avail.loansOutstanding > 0 && (
          <p className="text-[13px] text-ink-400 mt-2">I prestiti interni dal fondo tasse non sono disponibili finché non rientrano.</p>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { transactions, fetchTransactions } = useTransactionStore();
  const user = useAuthStore((s) => s.user);
  const goalSummary = useGoalStore((s) => s.summary);
  const fetchGoals = useGoalStore((s) => s.fetchGoals);
  // Ricorrenze con conferma manuale in attesa: banner in-app (la push non arriva nella webview).
  const rules = useRecurringStore((s) => s.rules);
  const fetchRules = useRecurringStore((s) => s.fetchRules);
  const pendingRules = rules.filter((r) => r.pendingAt);
  const [prev, setPrev] = useState(null);
  const [nextDeadline, setNextDeadline] = useState(null);
  const [incoming, setIncoming] = useState(null);
  const [resendState, setResendState] = useState("idle");
  const [avail, setAvail] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [monthOpen, setMonthOpen] = useState(() => window.matchMedia("(min-width: 768px)").matches);

  useEffect(() => {
    fetchTransactions({ month: MONTH, year: YEAR });
    fetchGoals().catch(() => {});
    fetchRules().catch(() => {});
  }, [fetchTransactions, fetchGoals, fetchRules]);

  useEffect(() => {
    api.get("/api/transactions", { params: { month: prevDate.getMonth() + 1, year: prevDate.getFullYear() } })
      .then(({ data }) => {
        let income = 0, expense = 0;
        for (const t of data) (t.type === "INCOME" ? (income += t.amount) : (expense += t.amount));
        setPrev({ income, expense });
      })
      .catch(() => setPrev(null));
    api.get("/api/treasury/expected-collections").then(({ data }) => setIncoming(data)).catch(() => setIncoming(null));
    api.get("/api/deadlines", { params: { includePaid: "false" } })
      .then(({ data }) => setNextDeadline(data.find((d) => d.daysUntil <= 60) || null))
      .catch(() => setNextDeadline(null));
  }, []);

  // Il Disponibile reale si ricalcola quando cambiano le transazioni del mese (WS incluso).
  useEffect(() => {
    api.get("/api/dashboard/available").then(({ data }) => setAvail(data)).catch(() => setAvail(null));
  }, [transactions]);

  // Primo accesso: nessun punto zero e nessuna transazione → wizard "Punto zero" (una volta sola).
  useEffect(() => {
    if (!avail || avail.hasOpeningBalance || transactions.length > 0 || avail.balance !== 0) return;
    let seen = "1";
    try { seen = localStorage.getItem("onboardingSeen"); } catch { /* storage non disponibile */ }
    if (!seen) navigate("/onboarding");
  }, [avail, transactions, navigate]);

  const { income, expense, fixedSoFar } = useMemo(() => {
    let income = 0, expense = 0, fixedSoFar = 0;
    for (const t of transactions) {
      if (t.type === "INCOME") income += t.amount;
      else { expense += t.amount; if (t.recurringRuleId) fixedSoFar += t.amount; }
    }
    return { income, expense, fixedSoFar };
  }, [transactions]);

  // Previsione fine mese: fisse una volta sola (registrate + dovute), variabili proiettate.
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(YEAR, MONTH, 0).getDate();
  const avgDailyVariable = (expense - fixedSoFar) / Math.max(1, dayOfMonth);
  const fixedTotal = fixedSoFar + (avail?.committedUntilMonthEnd || 0);
  const forecastExpense = avgDailyVariable * daysInMonth + fixedTotal;

  // Colore della card: rosso solo < 0, giallo < 20% delle fisse mensili, altrimenti neutro.
  const tone = avail?.status === "NEGATIVE"
    ? "bg-rose-600 text-white"
    : avail?.status === "LOW"
      ? "bg-tax-600 text-white"
      : "bg-white border border-card-line text-ink-900";
  const muted = avail?.status === "OK" || !avail ? "text-ink-600" : "text-white/80";

  return (
    <div className="space-y-4">
      {user?.emailVerified === false && (
        <div className="bg-tax-50 text-tax-600 rounded-xl p-3 text-[13px] flex items-center justify-between gap-3">
          <span>✉ Conferma la tua email ({user.email}).</span>
          <button
            type="button"
            disabled={resendState !== "idle"}
            className="shrink-0 font-semibold underline disabled:opacity-50 min-h-[44px]"
            onClick={async () => {
              setResendState("sending");
              try { await api.post("/api/auth/resend-verification"); setResendState("sent"); } catch { setResendState("idle"); }
            }}
          >
            {resendState === "sent" ? "Inviata ✓" : resendState === "sending" ? "Invio…" : "Reinvia"}
          </button>
        </div>
      )}

      <NotificationsToggle />

      {pendingRules.length > 0 && (
        <button
          type="button"
          onClick={() => navigate("/movements?tab=recurring")}
          className="w-full text-left bg-tax-50 text-tax-600 rounded-xl p-3 text-[13px] flex items-center justify-between gap-3 min-h-[52px]"
        >
          <span>
            <span className="font-semibold">Da confermare:</span>{" "}
            {pendingRules.map((r) => `${r.description || r.category} ${eur(r.amount)} del ${dayjs(r.pendingAt).format("D/M")}`).join(" · ")}
          </span>
          <span className="shrink-0 font-semibold">Apri ›</span>
        </button>
      )}

      {/* 1. Con più conti: una card grande per conto, nell'ordine scelto in Impostazioni.
             Con un solo conto: il Disponibile reale come numero grande. */}
      {avail?.accounts?.length > 1 ? (
        <>
          {avail.accounts.map((a) => {
            let inc = 0, exp = 0;
            for (const t of transactions) {
              const mine = t.accountId === a.id || (a.isDefault && !t.accountId);
              if (!mine) continue;
              if (t.type === "INCOME") inc += t.amount; else exp += t.amount;
            }
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => navigate(`/movements?tab=expenses&account=${a.id}`)}
                className={`w-full text-left rounded-2xl p-5 ${a.balance < 0 ? "bg-rose-50 text-rose-700" : "bg-white border border-card-line text-ink-900"}`}
              >
                <div className="text-[13px] uppercase tracking-widest text-ink-600">{a.name}</div>
                <div className="text-4xl sm:text-5xl font-bold tracking-tight mt-1 nums">{eur(a.balance)}</div>
                <div className="text-[13px] mt-1.5 text-ink-600 flex flex-wrap gap-x-2">
                  <span className="text-brand-600 nums">+{eur(inc)}</span>
                  <span className="nums">−{eur(exp)}</span>
                  <span className="text-ink-400">{MONTH_NAME} · tocca per i movimenti</span>
                </div>
              </button>
            );
          })}
          <button type="button" onClick={() => setSheet(true)} className="w-full text-left px-1 py-2 min-h-[44px] flex items-center justify-between gap-3 text-[13px] text-ink-600">
            <span>Disponibile reale <span className="text-ink-400">(totale meno impegni)</span></span>
            <span className="shrink-0"><span className={`font-semibold nums ${avail.available < 0 ? "text-rose-600" : "text-ink-900"}`}>{eur(avail.available)}</span> <span className="text-ink-400">›</span></span>
          </button>
        </>
      ) : (
      <button type="button" onClick={() => avail && setSheet(true)} className={`w-full text-left rounded-2xl p-5 ${tone}`}>
        <div className={`text-[13px] uppercase tracking-widest ${muted}`}>Disponibile reale</div>
        <div className="text-4xl sm:text-5xl font-bold tracking-tight mt-1 nums">
          {!avail ? "…" : !avail.hasOpeningBalance && avail.balance === 0 ? "—" : eur(avail.available)}
        </div>
        {avail && (
          <div className={`text-[13px] mt-1.5 ${muted}`}>
            {avail.hasOpeningBalance ? (
              <>Saldo effettivo {eur(avail.balance)} · tocca per il dettaglio</>
            ) : (
              <span
                role="link"
                onClick={(e) => { e.stopPropagation(); navigate("/onboarding"); }}
                className="underline"
              >
                Imposta il saldo iniziale per un disponibile reale attendibile
              </span>
            )}
          </div>
        )}
      </button>
      )}

      {/* 2. Tre card compatte (scroll orizzontale su mobile) */}
      <div className="flex gap-3 overflow-x-auto snap-x -mx-4 px-4 sm:mx-0 sm:px-0 pb-1">
        <MiniCard
          label="Obiettivi"
          value={goalSummary?.count ? `${eur(goalSummary.parked)} parcheggiati` : "Nessuno"}
          sub={goalSummary?.count ? `quota di ${MONTH_NAME} ${eur(goalSummary.monthQuota)} · versati ${eur(goalSummary.monthContributed)}` : "Crea il primo obiettivo"}
          tone={goalSummary?.behind ? "text-rose-600" : "text-ink-900"}
          onClick={() => navigate("/goals")}
        />
        <MiniCard
          label="In arrivo"
          value={incoming?.count ? eur(incoming.net ?? incoming.gross) : "—"}
          sub={incoming?.count ? `${incoming.count} ${incoming.count === 1 ? "fattura" : "fatture"} · primo incasso ${dayjs(incoming.nextExpectedAt).format("D MMM")}` : "Nessuna fattura in attesa"}
          tone="text-brand-600"
          onClick={() => navigate("/invoices")}
        />
        <MiniCard
          label="Prossima scadenza"
          value={nextDeadline ? eur(nextDeadline.expectedAmount) : "—"}
          sub={nextDeadline
            ? (nextDeadline.overdue ? `${nextDeadline.name} · scaduta da ${Math.abs(nextDeadline.daysUntil)} giorni` : `${nextDeadline.name} · tra ${nextDeadline.daysUntil} giorni`)
            : "Nessuna entro 60 giorni"}
          tone={nextDeadline?.overdue ? "text-rose-600" : nextDeadline && nextDeadline.daysUntil <= 30 ? "text-tax-600" : "text-ink-900"}
          onClick={() => navigate("/treasury")}
        />
      </div>

      {/* 3. Il mese (comprimibile, chiuso su mobile) */}
      <section className="card">
        <button
          type="button"
          onClick={() => setMonthOpen((o) => !o)}
          className="w-full px-4 py-3 min-h-[52px] flex items-center justify-between"
          aria-expanded={monthOpen}
        >
          <span className="font-semibold">Il mese · {MONTH_NAME}</span>
          <span className="flex items-center gap-3 text-[13px] text-ink-600">
            <span className="nums">+{eur(income)} · −{eur(expense)}</span>
            <ChevronIcon size={18} open={monthOpen} />
          </span>
        </button>
        {monthOpen && (
          <div className="px-4 pb-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => navigate("/movements?tab=income")} className="text-left">
                <div className="text-[13px] text-ink-600">Entrate</div>
                <div className="text-xl font-bold nums text-brand-600">{eur(income)}</div>
                <div className="text-[13px]">{prev ? <Delta value={pctChange(income, prev.income)} goodWhenUp /> : null} <span className="text-ink-400">vs mese prec.</span></div>
              </button>
              <button type="button" onClick={() => navigate("/movements?tab=expenses")} className="text-left">
                <div className="text-[13px] text-ink-600">Uscite</div>
                <div className="text-xl font-bold nums">{eur(expense)}</div>
                <div className="text-[13px]">{prev ? <Delta value={pctChange(expense, prev.expense)} goodWhenUp={false} /> : null} <span className="text-ink-400">vs mese prec.</span></div>
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-card-line pt-3">
              <div>
                <div className="text-[13px] font-semibold text-ink-600">Previsione spesa fine mese</div>
                <div className="text-[13px] text-ink-400 nums">
                  Variabili {eur(avgDailyVariable)}/giorno · {dayOfMonth} di {daysInMonth} giorni{fixedTotal > 0 && ` · fisse ${eur(fixedTotal)}`}
                </div>
              </div>
              <div className="text-xl font-bold nums">{eur(forecastExpense)}</div>
            </div>

            <Suspense fallback={<div className="h-64 animate-pulse bg-paper rounded" />}>
              <BalanceTrendChart transactions={transactions} month={MONTH} year={YEAR} />
            </Suspense>
          </div>
        )}
      </section>

      {sheet && avail && <BreakdownSheet avail={avail} onClose={() => setSheet(false)} />}
    </div>
  );
}
