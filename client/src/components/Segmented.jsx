// Gruppo di pulsanti al posto delle tendine — linea di design dell'app.
// Fino a 4 opzioni corte: controllo segmentato stile app (binario grigio,
// segmento attivo bianco che "scivola"). Più opzioni o etichette lunghe:
// chip a capo, così restano leggibili anche a 390 px.
export default function Segmented({ options, value, onChange, size = "md", className = "", chips }) {
  const useChips = chips ?? (options.length > 4 || options.some((o) => String(o.label).length > 14));
  if (useChips) {
    const pad = size === "sm" ? "px-3.5 text-[13px]" : "px-4 text-sm";
    return (
      <div className={`flex flex-wrap gap-2 ${className}`}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={active}
              className={`chip ${pad} ${active ? "chip-active" : ""}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className={`seg ${size === "sm" ? "seg-sm" : ""} ${className}`} role="group">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`seg-item ${active ? "seg-active" : ""}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
