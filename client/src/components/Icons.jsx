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

export const WalletIcon = (p) => (
  <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h13v4" /><rect x="3" y="7" width="18" height="12" rx="2" /><path d="M16 13h2" /></Svg>
);
export const ReceiptIcon = (p) => (
  <Svg {...p}><path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z" /><path d="M9 8h6M9 12h6" /></Svg>
);
export const PieIcon = (p) => (
  <Svg {...p}><path d="M12 3v9h9" /><path d="M21 12A9 9 0 1 1 12 3" /></Svg>
);
export const CartIcon = (p) => (
  <Svg {...p}><path d="M3 4h2l2.5 11h11L21 8H6.5" /><circle cx="9" cy="19" r="1.3" /><circle cx="17" cy="19" r="1.3" /></Svg>
);
export const GaugeIcon = (p) => (
  <Svg {...p}><path d="M4 16a8 8 0 1 1 16 0" /><path d="M12 16l4-5" /></Svg>
);
export const UploadIcon = (p) => (
  <Svg {...p}><path d="M12 16V5" /><path d="m7 10 5-5 5 5" /><path d="M4 19h16" /></Svg>
);
export const SettingsIcon = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.3 1a7 7 0 0 0-2-1.2L14 3h-4l-.6 2.6a7 7 0 0 0-2 1.2l-2.3-1-2 3.5 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.5 2 3.5 2.3-1a7 7 0 0 0 2 1.2L10 21h4l.6-2.6a7 7 0 0 0 2-1.2l2.3 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z" /></Svg>
);
export const SparkIcon = (p) => (
  <Svg {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" /></Svg>
);
export const CoinIcon = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M14.5 9.5a3 3 0 0 0-5 0c0 3 5 2 5 5a3 3 0 0 1-5 0" /><path d="M12 6v2M12 16v2" /></Svg>
);
export const RepeatIcon = (p) => (
  <Svg {...p}><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></Svg>
);
export const CheckIcon = (p) => (
  <Svg {...p}><path d="m5 12 4.5 4.5L19 7" /></Svg>
);
export const ChevronRightIcon = (p) => (
  <Svg {...p}><path d="m9 6 6 6-6 6" /></Svg>
);
