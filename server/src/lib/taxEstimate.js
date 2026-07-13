// Stima dei pagamenti fiscali del 30 giugno e 30 novembre (regime forfettario,
// metodo storico) a partire dalle fatture. Regime di cassa: il fatturato di un
// anno è la somma degli imponibili delle fatture INCASSATE in quell'anno.
//
//   dovuto(Y)  = imponibile incassato(Y) × coeffRedditivita × (aliquotaImposta + aliquotaInps)
//   giugno(Y)  = saldo anno Y−1 + 1° acconto anno Y   [saldo = dovuto(Y−1) − acconti versati(Y−1)]
//   novembre(Y)= 2° acconto anno Y
//   acconti anno Y = 100% del dovuto(Y−1), divisi 50/50 (metodo storico)
//   acconti versati durante Y−1 ≈ 100% del dovuto(Y−2)
//
// È una STIMA (niente minimali INPS, franchigie acconto, rate, ISA): serve a
// dimensionare l'accantonamento, non sostituisce il commercialista.
import { prisma } from "./prisma.js";

export const TAX_ESTIMATE_DISCLAIMER =
  "Stima con metodo storico sulle fatture incassate: non considera minimali INPS, rateazioni o casi particolari. Non è consulenza fiscale.";

async function collectedImponibileByYear(userId, years) {
  const invoices = await prisma.invoice.findMany({
    where: { userId, status: "INCASSATA", collectedAt: { not: null } },
    select: { imponibile: true, collectedAt: true },
  });
  const byYear = Object.fromEntries(years.map((y) => [y, 0]));
  for (const inv of invoices) {
    const y = inv.collectedAt.getUTCFullYear();
    if (y in byYear) byYear[y] += inv.imponibile;
  }
  return byYear;
}

export async function estimateTaxPayments({ userId, year }) {
  const fp = await prisma.fiscalProfile.findUnique({ where: { userId } });
  if (!fp || fp.coeffRedditivita == null || fp.aliquotaImposta == null || fp.aliquotaInps == null) {
    return {
      ok: false,
      reason: "PROFILO_INCOMPLETO",
      detail: "Servono coefficiente di redditività, aliquota imposta e aliquota INPS nel profilo fiscale.",
    };
  }

  const round2 = (v) => Math.round(v * 100) / 100;
  const taxOf = (revenue) => {
    const imponibileFiscale = revenue * fp.coeffRedditivita;
    const imposta = (imponibileFiscale * fp.aliquotaImposta) / 100;
    const inps = (imponibileFiscale * fp.aliquotaInps) / 100;
    return {
      revenue: round2(revenue),
      imponibileFiscale: round2(imponibileFiscale),
      imposta: round2(imposta),
      inps: round2(inps),
      total: round2(imposta + inps),
    };
  };

  const [byYear, pendingAgg] = await Promise.all([
    collectedImponibileByYear(userId, [year - 2, year - 1, year]),
    prisma.invoice.aggregate({
      _sum: { imponibile: true },
      _count: true,
      where: { userId, status: "EMESSA" },
    }),
  ]);

  const duePrev = taxOf(byYear[year - 1]); // dovuto per l'anno d'imposta Y−1
  const duePrev2 = taxOf(byYear[year - 2]);

  // Saldo Y−1: dovuto meno gli acconti (stimati) già versati durante Y−1.
  const saldo = round2(Math.max(0, duePrev.total - duePrev2.total));
  const acconto1 = round2(duePrev.total / 2);
  const acconto2 = round2(duePrev.total / 2);

  // Proiezione anno corrente: incassato YTD + fatture emesse in attesa d'incasso.
  const pendingImponibile = round2(pendingAgg._sum.imponibile || 0);
  const projected = taxOf(byYear[year] + pendingImponibile);

  return {
    ok: true,
    year,
    payments: {
      giugno: {
        dueDate: new Date(Date.UTC(year, 5, 30)),
        amount: round2(saldo + acconto1),
        detail: { saldoAnnoPrecedente: saldo, primoAcconto: acconto1 },
      },
      novembre: {
        dueDate: new Date(Date.UTC(year, 10, 30)),
        amount: acconto2,
        detail: { secondoAcconto: acconto2 },
      },
    },
    basedOn: {
      revenuePrevYear: duePrev.revenue,
      duePrevYear: duePrev,
      accontiVersatiStimati: duePrev2.total,
      revenueYtd: round2(byYear[year]),
      pendingCount: pendingAgg._count,
      pendingImponibile,
    },
    projectionCurrentYear: projected,
    noHistory: duePrev.revenue === 0,
    disclaimer: TAX_ESTIMATE_DISCLAIMER,
  };
}
