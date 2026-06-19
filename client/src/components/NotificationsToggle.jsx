import { useEffect, useState } from "react";
import { pushSupported, isPushEnabled, enablePush } from "../lib/push.js";

// Prompt to enable Web Push notifications. Hides itself once enabled or when the
// browser doesn't support push.
export default function NotificationsToggle() {
  const supported = pushSupported();
  const [enabled, setEnabled] = useState(true); // assume on until checked, avoids flicker
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (supported) isPushEnabled().then(setEnabled);
  }, [supported]);

  if (!supported || enabled) return null;

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await enablePush();
      setEnabled(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-amber-800">
        Attiva le notifiche push per ricevere i promemoria delle tasse.
      </span>
      <div className="flex items-center gap-3">
        {error && <span className="text-rose-600">{error}</span>}
        <button
          onClick={enable}
          disabled={busy}
          className="px-3 py-1.5 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50 whitespace-nowrap"
        >
          {busy ? "Attivazione…" : "Attiva notifiche"}
        </button>
      </div>
    </div>
  );
}
