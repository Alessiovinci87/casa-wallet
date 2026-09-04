import { create } from "zustand";

// Dialoghi dell'app al posto di window.confirm/prompt/alert (brutti su iOS e
// inaffidabili nella webview). Ogni chiamata ritorna una Promise:
//   await dialog.confirm({ title, message, okLabel?, cancelLabel?, danger? }) → boolean
//   await dialog.prompt({ title, message?, defaultValue?, placeholder?, inputMode?, okLabel? }) → string | null
//   await dialog.alert({ title, message? }) → void
// Il rendering sta in components/DialogHost.jsx (montato in Layout).
export const useDialogStore = create((set) => ({
  current: null, // { kind, title, message, ..., resolve }
  open: (spec) => new Promise((resolve) => set({ current: { ...spec, resolve } })),
  close: (value) => set((s) => { s.current?.resolve(value); return { current: null }; }),
}));

const open = (spec) => useDialogStore.getState().open(spec);

export const dialog = {
  confirm: (spec) => open({ kind: "confirm", ...(typeof spec === "string" ? { message: spec } : spec) }),
  prompt: (spec) => open({ kind: "prompt", ...(typeof spec === "string" ? { message: spec } : spec) }),
  alert: (spec) => open({ kind: "alert", ...(typeof spec === "string" ? { message: spec } : spec) }),
};

/** Chiede un importo in euro; null se annullato o non valido (mostra l'errore). */
export async function askAmount({ title, message, defaultValue = "" } = {}) {
  const raw = await dialog.prompt({ title, message, defaultValue: defaultValue === "" ? "" : String(defaultValue), inputMode: "decimal", placeholder: "0,00", okLabel: "Conferma" });
  if (raw == null) return null;
  const amount = Number(String(raw).replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) { await dialog.alert({ title: "Importo non valido", message: "Inserisci un numero maggiore di zero." }); return null; }
  return amount;
}
