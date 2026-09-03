import { useMemo } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import dayjs from "dayjs";
import { eur } from "../lib/format.js";

// Saldo proiettato giorno per giorno (F5). Linea zero e soglia "basso".
export default function ForecastChart({ daily, threshold }) {
  const data = useMemo(
    () => daily.map((d) => ({ day: dayjs(d.date).format("D/M"), Saldo: d.balance, flag: d.flag })),
    [daily]
  );
  const min = Math.min(0, ...data.map((d) => d.Saldo));
  const negative = data.some((d) => d.Saldo < 0);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 5, right: 8, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="fc" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={negative ? "#E11D48" : "#2F9A6E"} stopOpacity={0.35} />
            <stop offset="100%" stopColor={negative ? "#E11D48" : "#2F9A6E"} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#E4E9E6" />
        <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#8B9691" }} stroke="#E4E9E6" interval={Math.max(0, Math.floor(data.length / 8))} />
        <YAxis tick={{ fontSize: 11, fill: "#8B9691" }} stroke="#E4E9E6" width={56} domain={[min, "auto"]} />
        <Tooltip formatter={(v) => [eur(v), "Saldo proiettato"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <ReferenceLine y={0} stroke="#E11D48" strokeDasharray="4 4" />
        {threshold > 0 && <ReferenceLine y={threshold} stroke="#B3701A" strokeDasharray="2 4" />}
        <Area type="monotone" dataKey="Saldo" stroke={negative ? "#E11D48" : "#0A6847"} fill="url(#fc)" strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
