import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet.jsx";
import { useDialogStore } from "../lib/dialog.js";

// Rende il dialogo corrente (confirm / prompt / alert) come foglio dal basso.
export default function DialogHost() {
  const current = useDialogStore((s) => s.current);
  const close = useDialogStore((s) => s.close);
  const [value, setValue] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (current?.kind === "prompt") {
      setValue(current.defaultValue ?? "");
      setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select?.(); }, 50);
    }
  }, [current]);

  if (!current) return null;
  const { kind, title, message, okLabel, cancelLabel, danger, placeholder, inputMode } = current;
  const cancel = () => close(kind === "confirm" ? false : null);
  const ok = () => close(kind === "prompt" ? value : kind === "confirm" ? true : undefined);

  return (
    <Sheet title={title || (kind === "confirm" ? "Confermi?" : kind === "prompt" ? "Inserisci" : "Avviso")} onClose={cancel}>
      {message && <p className="text-[15px] text-ink-600 whitespace-pre-line">{message}</p>}
      {kind === "prompt" && (
        <form onSubmit={(e) => { e.preventDefault(); ok(); }} className="mt-3">
          <input
            ref={inputRef}
            type="text"
            inputMode={inputMode || "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className={`w-full ${inputMode === "decimal" ? "text-2xl font-bold nums" : ""}`}
            aria-label={title || "Valore"}
          />
        </form>
      )}
      <div className="flex gap-2 mt-4">
        {kind !== "alert" && (
          <button type="button" onClick={cancel} className="btn btn-secondary flex-1">{cancelLabel || "Annulla"}</button>
        )}
        <button type="button" onClick={ok} className={`btn flex-1 ${danger ? "btn-danger" : "btn-primary"}`}>{okLabel || (kind === "alert" ? "OK" : "Conferma")}</button>
      </div>
    </Sheet>
  );
}
