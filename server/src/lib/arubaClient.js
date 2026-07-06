// Client per l'API Aruba Fatturazione Elettronica.
// Rate limit documentati: signin ~1/min, ricerche ~12/min → il token (TTL 30
// min lato Aruba) viene cacheato per utente e riusato per 25 minuti.
export const ARUBA_AUTH_URL = "https://auth.fatturazioneelettronica.aruba.it";
export const ARUBA_WS_URL = "https://ws.fatturazioneelettronica.aruba.it";

const TOKEN_TTL_MS = 25 * 60 * 1000;
const tokenCache = new Map(); // userId → { token, exp }

export class ArubaError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function arubaFetch(url, options = {}, retried = false) {
  const res = await fetch(url, options);
  if (res.status === 429 && !retried) {
    await new Promise((r) => setTimeout(r, 5000));
    return arubaFetch(url, options, true);
  }
  return res;
}

/** Signin diretto (usato anche per validare le credenziali al connect). */
export async function arubaSignin(username, password) {
  const body = new URLSearchParams({ grant_type: "password", username, password });
  const res = await arubaFetch(`${ARUBA_AUTH_URL}/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (res.status === 401 || res.status === 400) {
    throw new ArubaError("Credenziali Aruba non valide", 401);
  }
  if (res.status === 429) {
    throw new ArubaError("Limite richieste Aruba raggiunto, riprova tra un minuto", 429);
  }
  if (!res.ok) {
    throw new ArubaError(`Aruba signin fallito (HTTP ${res.status})`, res.status);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new ArubaError("Risposta Aruba senza access_token", 502);
  }
  return data.access_token;
}

/** Token per utente, con cache 25 minuti (il signin è rate-limitato). */
export async function getArubaToken(userId, username, password) {
  const cached = tokenCache.get(userId);
  if (cached && cached.exp > Date.now()) return cached.token;
  const token = await arubaSignin(username, password);
  tokenCache.set(userId, { token, exp: Date.now() + TOKEN_TTL_MS });
  return token;
}

export function invalidateArubaToken(userId) {
  tokenCache.delete(userId);
}

/** Lista fatture inviate (v2), paginata. */
export async function listInvoicesOut(token, { page = 1, size = 100, modifiedStartDate } = {}) {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  if (modifiedStartDate) params.set("modifiedStartDate", modifiedStartDate);
  const res = await arubaFetch(`${ARUBA_WS_URL}/api/v2/invoices-out?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 429) {
    throw new ArubaError("Limite richieste Aruba raggiunto, riprova tra un minuto", 429);
  }
  if (res.status === 401) {
    throw new ArubaError("Token Aruba scaduto", 401);
  }
  if (!res.ok) {
    throw new ArubaError(`Aruba invoices-out fallito (HTTP ${res.status})`, res.status);
  }
  return res.json(); // { content: [...], totalPages, ... }
}

/** XML FatturaPA completo di una fattura inviata (campo file, base64). */
export async function getInvoiceXml(token, filename) {
  const params = new URLSearchParams({ filename, includeFile: "true" });
  const res = await arubaFetch(
    `${ARUBA_WS_URL}/services/invoice/out/getByFilename?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 429) {
    throw new ArubaError("Limite richieste Aruba raggiunto, riprova tra un minuto", 429);
  }
  if (!res.ok) {
    throw new ArubaError(`Aruba getByFilename fallito (HTTP ${res.status})`, res.status);
  }
  const data = await res.json();
  if (!data.file) {
    throw new ArubaError(`Fattura ${filename}: XML non presente nella risposta`, 502);
  }
  return Buffer.from(data.file, "base64").toString("utf8");
}
