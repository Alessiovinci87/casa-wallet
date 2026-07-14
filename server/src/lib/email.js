// Email sending via Resend. No-op (with a warning) when RESEND_API_KEY is unset,
// so local dev and tests don't fail just because email isn't configured.
import { Resend } from "resend";

// Resend's shared sandbox sender works without verifying a domain. Override with
// RESEND_FROM once a custom domain is configured.
const FROM = process.env.RESEND_FROM || "Awareness <onboarding@resend.dev>";

let client = null;
function getClient() {
  if (client) return client;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  client = new Resend(key);
  return client;
}

/**
 * Send an email to one or more recipients.
 * @param {{ to: string|string[], subject: string, html: string }} msg
 * @returns {Promise<{ skipped?: boolean }|object>}
 */
export async function sendEmail({ to, subject, html }) {
  const c = getClient();
  if (!c) {
    console.warn(`[email] RESEND_API_KEY non impostata — email saltata: "${subject}"`);
    return { skipped: true };
  }

  const recipients = Array.isArray(to) ? to : [to];
  const { data, error } = await c.emails.send({ from: FROM, to: recipients, subject, html });
  if (error) {
    console.error("[email] invio fallito:", error);
    throw new Error(error.message || "Invio email fallito");
  }
  return data;
}
