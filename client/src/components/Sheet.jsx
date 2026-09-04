import { useEffect } from "react";
import { XIcon } from "./Icons.jsx";

// Foglio dal basso (bottom sheet) stile app: maniglia, titolo, contenuto
// scorrevole, safe-area. Su desktop diventa una finestra centrata.
// Chiusura: tap sullo sfondo, X, tasto Esc.
export default function Sheet({ title, onClose, children, footer, size = "md" }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const width = size === "lg" ? "sm:max-w-xl" : "sm:max-w-md";
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className={`sheet-panel ${width}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
      >
        <div className="sheet-handle" aria-hidden="true" />
        {(title || onClose) && (
          <div className="flex items-center justify-between px-5 pt-1 pb-2">
            <h2 className="text-lg font-bold leading-tight">{title}</h2>
            {onClose && (
              <button type="button" onClick={onClose} className="w-11 h-11 -mr-3 flex items-center justify-center text-ink-400 rounded-full" aria-label="Chiudi" style={{ minWidth: 44 }}>
                <XIcon size={20} />
              </button>
            )}
          </div>
        )}
        <div className="sheet-body px-5 pb-4">{children}</div>
        {footer && <div className="sheet-footer px-5 pt-2">{footer}</div>}
      </div>
    </div>
  );
}
