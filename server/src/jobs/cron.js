// Scheduled background jobs. Started once from index.js after the server boots.
import cron from "node-cron";
import { sendTaxAlerts } from "../lib/taxAlert.js";
import { sendDeadlineReminders } from "../lib/deadlineReminder.js";

export function startCronJobs() {
  // Tax reminder: 1st day of every month at 09:00 Europe/Rome.
  cron.schedule(
    "0 9 1 * *",
    async () => {
      try {
        const result = await sendTaxAlerts();
        console.log("[cron] tax alert:", result);
      } catch (err) {
        console.error("[cron] tax alert fallito:", err);
      }
    },
    { timezone: "Europe/Rome" }
  );

  // Promemoria scadenze fiscali: ogni giorno alle 08:00 Europe/Rome (30/7/1 gg prima).
  cron.schedule(
    "0 8 * * *",
    async () => {
      try {
        const result = await sendDeadlineReminders();
        console.log("[cron] deadline reminders:", JSON.stringify(result));
      } catch (err) {
        console.error("[cron] deadline reminders falliti:", err);
      }
    },
    { timezone: "Europe/Rome" }
  );

  console.log("[cron] job mensile alert tasse schedulato (1° del mese, 09:00)");
  console.log("[cron] job giornaliero scadenze fiscali schedulato (08:00)");
}
