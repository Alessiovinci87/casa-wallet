# CasaWallet — Context

App di gestione economia domestica per 2 utenti fissi (Alessio e moglie).

## Stato avanzamento (aggiornato 18 giugno 2026)

### Completato ✅
- Setup monorepo /client + /server
- Schema Prisma: User, Transaction, TaxSaving, Alert, Receipt, ReceiptItem
  - Su `origin/main` (produzione): `provider postgresql` + enum `TxType`/`PayMethod`
  - Nel working tree locale: `provider sqlite`, `type`/`method` come `String` (gli enum Prisma non sono supportati su SQLite); valori validati lato API. **Modifica non committata.**
- Backend: auth JWT, CRUD transazioni, tax savings, OCR endpoint (GPT-4o Vision)
- WebSocket broadcast su ogni modifica transazioni
- Client React: store Zustand, routing, Login/Dashboard/Transactions/TaxSavings/OCR pages
- TransactionForm con modal + bottone OCR inline
- Fix mapping campi OCR (italiano → inglese lato server)
- **Estrazione prodotti da scontrini + analisi prezzi (backend, 18 giu 2026)** — Task 1/2
  - Modelli `Receipt` (testata scontrino: store, total, date, opz. link a Transaction) e `ReceiptItem` (rawName, canonicalName normalizzato, category da lista fissa, quantity, unitPrice, totalPrice)
  - OCR esteso: il prompt GPT-4o Vision ora restituisce anche `items[]` (prodotti+prezzi) con categoria tra 11 ammesse; categorie non valide normalizzate a "Altro" lato server (`server/src/lib/categories.js`)
  - Endpoint salvataggio scontrino + 4 endpoint analytics (vedi sotto)
  - Frontend = Task 2 (non ancora fatto)
- **Task 4 — test end-to-end locale (SQLite): ESEGUITO e superato**
  - `prisma migrate dev --name init` + `seed` eseguiti (2 utenti creati)
  - Test curl a–f tutti ✅ (health, login, EXPENSE, INCOME @25%, `tax-savings/summary` → `totalPending: 500`, lista transazioni)
  - Server (:3001) e client (:5173) avviati e funzionanti
  - Migration SQLite (`prisma/migrations/`) e `dev.db` sono locali/non committati (`*.db` in .gitignore)

### Da fare 📋
- [ ] Verifica manuale nel browser (login + UI) — ultimo residuo di Task 4
- [ ] Configurare `OPENAI_API_KEY` (e riavviare il server) per testare l'OCR
- [ ] Task 5: deploy Railway (PostgreSQL prod) + Vercel (client)
  - **Config preparata (18 giu 2026)** — vedi sezione "Deploy (produzione)" più sotto. Deploy manuale da dashboard ancora da eseguire.
- [ ] Task 6: cron alert tasse mensile (Resend email)
- [ ] Task 7: test end-to-end con entrambi gli utenti + WebSocket sync reale
- [ ] Eventuale debounce filtro anno in TransactionsPage

### Prossima sessione — note di ripartenza
- Le modifiche locali a `schema.prisma` (SQLite + String) e la migration sono **non committate**: decidere se committarle su un branch dev separato o tenerle solo locali.
- Per riavviare l'ambiente locale: `cd server && npm run dev` (DB SQLite `dev.db` già migrato e popolato; rieseguire `npx prisma migrate dev` solo se lo schema cambia).

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
- `POST /parse` → `multipart/form-data` campo `image` → GPT-4o Vision → JSON `{ store, total, date, method, items: [{ rawName, canonicalName, category, quantity, unitPrice, totalPrice }], amount, type, description }`
  - `amount`/`type`/`description` sono campi di compatibilità per il prefill del form transazione (amount=total, type="EXPENSE", description=store)
  - `category` di ogni item è una delle 11 categorie ammesse; valori imprevisti → "Altro"
  - notifica bancaria senza prodotti → `items: []`

### Receipts (`/api/receipts`) — protette
- `POST /` → body `{ store, total, date, method, transactionId?, items: [...] }` → crea `Receipt` + `ReceiptItem` (nested), opz. collega a una Transaction. Broadcast WS `receipt_update`. Gli item ereditano `store`/`date` dalla testata se mancanti; categoria normalizzata.
- `GET /?store=&from=&to=` → scontrini con `items`, più recenti prima

### Analytics (`/api/analytics`) — protette (sugli scontrini)
- `GET /by-category?from=&to=` → `[{ category, total, count }]` (spesa per categoria)
- `GET /product-trend?canonicalName=&from=&to=` → `[{ date, store, unitPrice, totalPrice }]` ordinato per data (storico prezzo prodotto)
- `GET /by-store?from=&to=` → `[{ store, total, receiptCount }]`
- `GET /top-products?limit=20&from=&to=` → `[{ canonicalName, category, totalSpent, timesBought, avgPrice }]` (prodotti su cui si spende di più)

## WebSocket
Endpoint `ws://<host>/ws`. Eventi server→client per il sync real-time: `transaction_update` (transazioni) e `receipt_update` (scontrini).

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

## Deploy (produzione)

> Il deploy si fa manualmente dalle dashboard Railway e Vercel. I file di config sono già pronti nel repo.

### Schema / provider — strategia dual-provider
- **Committato (`origin/main`)**: `schema.prisma` con `provider = "postgresql"` + enum veri `TxType`/`PayMethod`. È la **sorgente di verità per la produzione**.
- **Locale (dev)**: `schema.prisma` viene tenuto modificato a `provider = "sqlite"` + `type`/`method` come `String` — **modifica non committata** apposta. Idem la cartella `server/prisma/migrations/` e `dev.db`: locali, ignorati da git (`.gitignore`). Non committare l'override sqlite, romperebbe la prod.

### Backend → Railway
- `server/Procfile`, `server/railway.json` (NIXPACKS, `node src/index.js`, restart ON_FAILURE), `engines.node >=18`.
- **Init DB al primo deploy**: eseguire `server/prisma/migrate-deploy.sh` →
  - `npx prisma db push` (crea le tabelle Postgres direttamente dallo schema committato — non servono file di migration)
  - `node prisma/seed.js` (crea i 2 utenti)
- Variabili Railway da impostare: `DATABASE_URL` (Postgres del plugin Railway), `JWT_SECRET`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `CLIENT_URL` (URL Vercel), `PORT` (Railway lo inietta), `SEED_USER*`.
- `.sh` forzato a LF via `.gitattributes` (gira su Linux anche se committato da Windows).

### Frontend → Vercel
- `client/vercel.json` con rewrite SPA (`/(.*) → /index.html`) per React Router.
- Variabili Vercel: `VITE_API_URL` (URL Railway), `VITE_WS_URL` (`wss://<railway-host>/ws`).

> Nota: si è scelto `prisma db push` invece di `prisma migrate deploy` perché non esiste un Postgres locale per autorare migration e l'app (2 utenti) non necessita di storico migration. Se in futuro servisse, generare la migration Postgres offline con `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` e committarla.
