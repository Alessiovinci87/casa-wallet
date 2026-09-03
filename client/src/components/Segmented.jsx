// Gruppo di pulsanti al posto delle tendine — linea di design dell'app:
// le scelte tra poche opzioni si fanno con button, non con <select>.
export default function Segmented({ options, value, onChange, size = "md", className = "" }) {
  const pad = size === "sm" ? "px-3 py-2 text-[13px] min-h-[44px]" : "px-4 py-2 text-sm min-h-[44px]";
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`${pad} rounded-lg font-medium transition-colors ${
              active
                ? "bg-brand-600 text-white"
                : "bg-white border border-card-line text-ink-600 hover:bg-brand-50"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
