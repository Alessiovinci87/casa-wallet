# CasaWallet — Context

App di gestione economia domestica per 2 utenti fissi (Alessio e moglie).

## Stack
- /client: React + Vite + Tailwind → Vercel
- /server: Node + Express + Prisma + PostgreSQL → Railway

## Utenti
Solo 2 account fissi, creati via seed. Nessuna registrazione pubblica.

## Funzionalità core
- Entrate/uscite con categoria, metodo pagamento (contanti/POS/carta/bonifico)
- Salvadanaio tasse: % su ogni entrata → saldo virtuale separato → alert mensile
- OCR: upload screenshot notifica banca → GPT-4o Vision → pre-compila form
- Real-time sync tra i due utenti via WebSocket
- Alert: email (Resend) + push (Expo, futuro)

## Variabili ambiente
Vedi /server/.env.example e /client/.env.example
