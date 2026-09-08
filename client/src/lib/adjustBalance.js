import { dialog } from "./dialog.js";
import { eur } from "./format.js";
import { useAccountStore } from "../store/accountStore.js";

/**
 * Chiede il saldo reale del conto (quello che si vede in banca) e registra la
 * differenza come movimento "Rettifica saldo". Ritorna true se qualcosa è cambiato.
 */
export async function adjustAccountBalance(account) {
  const raw = await dialog.prompt({
    title: `Rettifica saldo · ${account.name}`,
    message: `L'app calcola ${eur(account.balance)}. Scrivi il saldo che vedi in banca adesso: la differenza viene registrata come "Rettifica saldo" di oggi (la puoi eliminare dai Movimenti).`,
    defaultValue: String(account.balance),
    inputMode: "decimal",
    placeholder: "0,00",
    okLabel: "Allinea",
  });
  if (raw == null) return false;
  const balance = Number(String(raw).replace(/\s|€/g, "").replace(",", "."));
  if (!Number.isFinite(balance)) { await dialog.alert({ title: "Saldo non valido", message: "Inserisci un numero, anche negativo." }); return false; }
  try {
    const r = await useAccountStore.getState().adjustBalance(account.id, balance);
    if (r.diff === 0) { await dialog.alert({ message: "Il saldo era già allineato." }); return false; }
    const sign = r.diff > 0 ? "+" : "−";
    await dialog.alert({
      title: "Saldo allineato",
      message: r.mode === "opening"
        ? `Corretto il saldo iniziale di ${sign}${eur(Math.abs(r.diff))}. Ora il conto segna ${eur(r.balance)}.`
        : `Registrata una rettifica di ${sign}${eur(Math.abs(r.diff))}. Ora il conto segna ${eur(r.balance)}.`,
    });
    return true;
  } catch (err) {
    await dialog.alert({ title: "Rettifica non riuscita", message: err.response?.data?.error || "Riprova." });
    return false;
  }
}
