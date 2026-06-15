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

## API Routes
Tutte le route (eccetto login) richiedono header `Authorization: Bearer <token>`.

### Auth (`/api/auth`)
- `POST /login` → `{ token, user: {id, name, email} }`
- `POST /refresh` → rinnova il token (richiede token)
- `GET /me` → utente corrente

### Transactions (`/api/transactions`) — protette
- `POST /` → crea transazione; se `type=INCOME` e `taxPercent>0` crea anche il TaxSaving collegato
- `GET /?month=&year=&type=&category=&method=` → lista filtrata (il filtro data richiede almeno `year`)
- `PUT /:id` → modifica (riallinea il TaxSaving)
- `DELETE /:id` → elimina (rimuove anche il TaxSaving collegato)
- Ogni POST/PUT/DELETE → broadcast WebSocket: `{ event: "transaction_update", payload: { action, transaction } }`

### Tax Savings (`/api/tax-savings`) — protette
- `GET /` → `{ totalPending, items }`
- `GET /summary` → `{ totalPending, byMonth: [{month, year, amount, transferred}] }`
- `PUT /:id/transfer` → marca come trasferito

### OCR (`/api/ocr`) — protetta
- `POST /parse` → `multipart/form-data` campo `image` → GPT-4o Vision → JSON `{ importo, tipo, descrizione, data, metodo }`

## WebSocket
Endpoint `ws://<host>/ws`. Eventi server→client per il sync real-time delle transazioni.

## Struttura client (`/client/src`)
- `lib/api.js` — istanza axios (baseURL `VITE_API_URL`), interceptor: aggiunge `Bearer` token, su 401 logout + redirect `/login`
- `lib/constants.js` — categorie predefinite (INCOME/EXPENSE), metodi pagamento + label
- `lib/format.js` — formattazione valuta EUR
- `store/authStore.js` — `{ user, token, login, logout, loadFromStorage }` (zustand)
- `store/transactionStore.js` — `{ transactions, loading, filters, fetch/add/update/delete }`
- `store/taxStore.js` — `{ summary, items, fetchSummary, markTransferred }`
- `hooks/useWebSocket.js` — connessione a `VITE_WS_URL`, refresh su `transaction_update`, riconnessione 3s
- `components/` — `PrivateRoute`, `Layout` (nav + WS), `TransactionForm` (modal + bottone OCR)
- `pages/` — `LoginPage`, `Dashboard`, `TransactionsPage`, `TaxSavingsPage`, `OcrPage`

### Routing
Pubbliche: `/login`. Protette (PrivateRoute → Layout): `/` (Dashboard), `/transactions`, `/tax-savings`, `/ocr`.

### Env client
`VITE_API_URL`, `VITE_WS_URL` — vedi `/client/.env.example`.
