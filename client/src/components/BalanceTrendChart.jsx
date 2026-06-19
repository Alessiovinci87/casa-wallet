import { useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { eur } from "../lib/format.js";

// Daily trend for the current month: per-day income, per-day expense, and the
// running net balance (income − expense − tax set aside, consistent with the
// dashboard's "Saldo mese"). `transactions` is the current month's list.
export default function BalanceTrendChart({ transactions, month, year }) {
  const data = useMemo(() => {
    const daysInMonth = new Date(year, month, 0).getDate();
    const days = Array.from({ length: daysInMonth }, () => ({ income: 0, expense: 0 }));

    for (const t of transactions) {
      const d = new Date(t.date).getUTCDate() - 1;
      if (d < 0 || d >= daysInMonth) continue;
      if (t.type === "INCOME") {
        days[d].income += t.amount;
        days[d].expense += t.taxAmount || 0; // tax set aside lowers the spendable balance
      } else {
        days[d].expense += t.amount;
      }
    }

    let running = 0;
    return days.map((d, i) => {
      running += d.income - d.expense;
      return {
        day: i + 1,
        Entrate: Math.round(d.income * 100) / 100,
        Uscite: Math.round(d.expense * 100) / 100,
        Saldo: Math.round(running * 100) / 100,
      };
    });
  }, [transactions, month, year]);

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-600 mb-3">Andamento del mese</h2>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 5, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#94a3b8" />
          <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={48} />
          <Tooltip
            formatter={(value, name) => [eur(value), name]}
            labelFormatter={(d) => `Giorno ${d}`}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="Entrate" stroke="#10b981" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="Uscite" stroke="#f43f5e" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="Saldo" stroke="#0ea5e9" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
