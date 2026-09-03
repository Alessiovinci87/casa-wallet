// Icone inline SVG (stroke, 24px viewBox): nessuna libreria aggiuntiva nel bundle.
const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };

function Svg({ size = 22, children, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...base} {...rest}>
      {children}
    </svg>
  );
}

export const HomeIcon = (p) => (
  <Svg {...p}><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h5v-6h4v6h5V10" /></Svg>
);
export const ListIcon = (p) => (
  <Svg {...p}><path d="M4 7h16M4 12h16M4 17h10" /></Svg>
);
export const TargetIcon = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /></Svg>
);
export const ChartIcon = (p) => (
  <Svg {...p}><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 14 4-4 3 3 5-6" /></Svg>
);
export const MoreIcon = (p) => (
  <Svg {...p}><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" /></Svg>
);
export const PlusIcon = (p) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);
export const CameraIcon = (p) => (
  <Svg {...p}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></Svg>
);
export const MinusCircleIcon = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></Svg>
);
export const PlusCircleIcon = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></Svg>
);
export const ChevronIcon = ({ open, ...p }) => (
  <Svg {...p} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}><path d="m6 9 6 6 6-6" /></Svg>
);
export const XIcon = (p) => (
  <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>
);
