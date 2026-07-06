// Cifratura segreti (credenziali connettori) — AES-256-GCM.
// La chiave deriva da INVOICE_CRED_SECRET (env): senza, le route connettore
// rispondono con un errore parlante invece di salvare password in chiaro.
import crypto from "node:crypto";

function getKey() {
  const secret = process.env.INVOICE_CRED_SECRET;
  if (!secret) {
    throw new Error("INVOICE_CRED_SECRET non configurata sul server");
  }
  return crypto.scryptSync(secret, "casawallet-aruba", 32);
}

/** Cifra un segreto → "ivB64:tagB64:cipherB64". */
export function encryptSecret(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

/** Decifra il formato di encryptSecret. */
export function decryptSecret(payload) {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = String(payload).split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
