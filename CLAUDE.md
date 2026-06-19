# CasaWallet — Context

App di gestione economia domestica per 2 utenti fissi (Alessio e moglie).

## Stato avanzamento (aggiornato 19 giugno 2026)

### Completato ✅
- Setup monorepo /client + /server
- Schema Prisma: User, Transaction, TaxSaving, Alert, Receipt, ReceiptItem, RecurringProduct, ShoppingListDismissal, CategoryBudget, PushSubscription
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
  - **Frontend fatto** (18 giu 2026): pagina "Nuova spesa" + "Analisi" (vedi sotto)
- **Lista della spesa predittiva (backend, 18 giu 2026)** — impara dallo storico riacquisti
  - Modelli `RecurringProduct` (prodotto ricorrente fisso: `alwaysBuy`, `intervalDays` opz. override) e `ShoppingListDismissal` (prodotto nascosto fino al prossimo acquisto)
  - Servizio `server/src/lib/shoppingPredictor.js` → `computeShoppingList(userId)`: raggruppa i `ReceiptItem` per `canonicalName`, intervallo medio semplice tra acquisti (1 acquisto per giorno), data prossimo riacquisto previsto, `isDue` quando scaduto
  - Endpoint shopping-list + recurring (vedi sotto)
  - **Frontend fatto** (18 giu 2026): pagina "Lista spesa" (vedi sotto)
- **Frontend completo scontrini + analisi + lista spesa + FIX (18 giu 2026)**
  - **FIX refresh→login**: `authStore` ora ha flag `hydrated`; `App.jsx` mostra spinner finché non idratato; `PrivateRoute` non redirige durante l'idratazione; l'interceptor 401 sloggia solo se c'era un token (no logout su 401 anonimi/boot)
  - **FIX CORS**: `server/src/index.js` accetta `CLIENT_URL` + qualsiasi `*.vercel.app` + richieste senza Origin
  - **OCR multi-immagine**: `POST /api/ocr/parse` ora accetta più file nel campo `images` (modalità "Scontrino lungo") e li unisce in un unico scontrino con una sola chiamata GPT-4o
  - **`POST /api/receipts` con `createTransaction:true`**: crea la transazione EXPENSE (scala il saldo una volta) + il receipt collegato, atomico; broadcast `transaction_update` + `receipt_update`
  - Pagine: `OcrPage` (cattura camera/galleria, scontrino lungo, conferma editabile), `AnalyticsPage` (/analytics), `ShoppingListPage` (/shopping-list)
  - Store: `receiptStore`, `analyticsStore`, `shoppingListStore`; `useWebSocket` aggiorna le viste su `receipt_update`/`shopping_list_update`
- **Task 4 — test end-to-end locale (SQLite): ESEGUITO e superato**
  - `prisma migrate dev --name init` + `seed` eseguiti (2 utenti creati)
  - Test curl a–f tutti ✅ (health, login, EXPENSE, INCOME @25%, `tax-savings/summary` → `totalPending: 500`, lista transazioni)
  - Server (:3001) e client (:5173) avviati e funzionanti
  - Migration SQLite (`prisma/migrations/`) e `dev.db` sono locali/non committati (`*.db` in .gitignore)
- **10 miglioramenti (19 giu 2026)** — pushati su `origin/main` (commit `f378131`..`72cb1f1`). Build client OK, server avvia con tutte le route, endpoint principali testati via curl.
  1. **Alert tasse mensile** — cron `node-cron` (1° del mese 09:00 Europe/Rome, `server/src/jobs/cron.js`) → email (Resend, `lib/email.js`) + Web Push a entrambi gli utenti con il totale tasse non trasferite. Endpoint test `POST /api/tax-savings/send-alert`. No-op se chiavi assenti.
  2. **Budget per categoria** — modello `CategoryBudget`, route CRUD `/api/budgets` (spesa mese corrente + percent + flag over), pagina `/budgets` con barra colorata e alert >80%.
  3. **Grafico andamento saldo** — `recharts`; `components/BalanceTrendChart.jsx` in Dashboard (entrate/uscite giornaliere + saldo cumulativo).
  4. **Export CSV** — `lib/exportCsv.js` + bottone in TransactionsPage (lista filtrata, `;` + BOM UTF-8, decimali con virgola).
  5. **Web Push (VAPID)** — modello `PushSubscription`, `lib/push.js` (web-push, pruning 404/410), route `/api/push` (public-key/subscribe/unsubscribe/test), service worker `client/public/sw.js`, helper `client/src/lib/push.js`, toggle "Attiva notifiche" in Dashboard. Sostituisce il vecchio piano "Expo".
  6. **Debounce filtro anno** — 400ms sul campo anno in TransactionsPage.
  7. **Confronto mese su mese** — riga in Dashboard con Δ% entrate/uscite/tasse vs mese precedente (verde/rosso).
  8. **Previsione fine mese** — card in Dashboard: media giornaliera + spesa proiettata a fine mese.
  9. **Store più conveniente** — endpoint `GET /api/analytics/store-comparison`, sezione "Dove conviene comprare" in AnalyticsPage.
  10. **Riepilogo rapido** — pagina `/summary` mobile-first (saldo, tasse, prodotti `isDue`).

### Da fare 📋
- [ ] Verifica manuale nel browser (login + UI) — ultimo residuo di Task 4
- [ ] Configurare `OPENAI_API_KEY` (e riavviare il server) per testare l'OCR
- [ ] Task 5: deploy Railway (PostgreSQL prod) + Vercel (client)
  - **Config preparata (18 giu 2026)** — vedi sezione "Deploy (produzione)" più sotto. Deploy manuale da dashboard ancora da eseguire.
  - **Al prossimo deploy**: rieseguire `npx prisma db push` (nuove tabelle `CategoryBudget`, `PushSubscription`) e impostare le env `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (+ opz. `RESEND_FROM`); senza, push/email restano no-op.
- [ ] Task 7: test end-to-end con entrambi gli utenti + WebSocket sync reale
- [x] ~~Task 6: cron alert tasse mensile (Resend email)~~ — fatto (19 giu 2026, + Web Push)
- [x] ~~Debounce filtro anno in TransactionsPage~~ — fatto (19 giu 2026)

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
- Alert: email (Resend) + Web Push (VAPID), inviati insieme dal cron mensile tasse
- Budget mensile per categoria, grafici (recharts), export CSV, confronto mese su mese, previsione fine mese, confronto prezzi tra negozi, riepilogo rapido `/summary`

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
- `POST /send-alert` → invia subito l'email + push di promemoria tasse (per test; il cron lo fa il 1° del mese alle 09:00 Europe/Rome via `node-cron`, `server/src/jobs/cron.js`). Email via Resend (`lib/email.js`), push via VAPID (`lib/push.js`); entrambi no-op se le chiavi non sono configurate.

### OCR (`/api/ocr`) — protetta
- `POST /parse` → `multipart/form-data` campo `images` (uno o più file; più file = sezioni di un unico scontrino lungo, unite in una sola chiamata GPT-4o) → JSON `{ store, total, date, method, items: [{ rawName, canonicalName, category, quantity, unitPrice, totalPrice }], amount, type, description }`
  - `amount`/`type`/`description` sono campi di compatibilità per il prefill del form transazione (amount=total, type="EXPENSE", description=store)
  - `category` di ogni item è una delle 11 categorie ammesse; valori imprevisti → "Altro"
  - notifica bancaria senza prodotti → `items: []`

### Receipts (`/api/receipts`) — protette
- `POST /` → body `{ store, total, date, method, category?, items: [...], createTransaction?, transactionId? }` → crea `Receipt` + `ReceiptItem` (nested). Con `createTransaction:true` crea anche la transazione EXPENSE collegata (scala il saldo una volta, categoria default "Spesa", broadcast `transaction_update` + `receipt_update`, atomico). Altrimenti opz. collega a una Transaction esistente via `transactionId`. Gli item ereditano `store`/`date` dalla testata se mancanti; categoria normalizzata.
- `GET /?store=&from=&to=` → scontrini con `items`, più recenti prima

### Analytics (`/api/analytics`) — protette (sugli scontrini)
- `GET /by-category?from=&to=` → `[{ category, total, count }]` (spesa per categoria)
- `GET /product-trend?canonicalName=&from=&to=` → `[{ date, store, unitPrice, totalPrice }]` ordinato per data (storico prezzo prodotto)
- `GET /by-store?from=&to=` → `[{ store, total, receiptCount }]`
- `GET /top-products?limit=20&from=&to=` → `[{ canonicalName, category, totalSpent, timesBought, avgPrice }]` (prodotti su cui si spende di più)
- `GET /store-comparison?from=&to=` → `[{ category, stores: [{ store, avgUnitPrice, count }], cheapest }]` (prezzo unitario medio per categoria nei vari negozi; solo categorie comprate in ≥2 store; `stores` ordinati dal più conveniente)

### Budget per categoria (`/api/budgets`) — protette
- `GET /` → `[{ id, category, amount, spent, percent, over }]` (budget dell'utente + spesa del mese corrente calcolata dalle transazioni EXPENSE della famiglia)
- `POST /` → body `{ category, amount }`: upsert `CategoryBudget` (unique su userId+category)
- `PUT /:id` → aggiorna `amount`; `DELETE /:id` → elimina

### Push notifications (`/api/push`) — protette (Web Push / VAPID)
- `GET /public-key` → `{ publicKey }` (chiave VAPID pubblica; `null` se non configurato)
- `POST /subscribe` → body subscription `{ endpoint, keys: { p256dh, auth } }`: upsert `PushSubscription`
- `POST /unsubscribe` → body `{ endpoint }`; `POST /test` → invia una push di prova a tutte le subscription

### Shopping list predittiva (`/api/shopping-list`) — protette
- `GET /?onlyDue=true` → lista predittiva da `computeShoppingList(userId)`; ogni elemento: `{ canonicalName, category, timesBought, avgIntervalDays, lastPurchase, predictedNextPurchase, daysRemaining, isDue, isRecurring, avgPrice, lastStore }`. Ordinata per urgenza (due prima, poi `daysRemaining` crescente). `?onlyDue=true` filtra solo i prodotti da ricomprare.
- `POST /dismiss` → body `{ canonicalName }`: upsert di `ShoppingListDismissal` (nasconde il prodotto finché non lo si riacquista). Broadcast WS `shopping_list_update`.

### Recurring products (`/api/recurring`) — protette
- `GET /` → prodotti ricorrenti dell'utente
- `POST /` → body `{ canonicalName, alwaysBuy?, intervalDays? }`: upsert `RecurringProduct` (unique su userId+canonicalName)
- `DELETE /:canonicalName` → rimuove il flag ricorrente

Logica predittiva (dettaglio): per ogni `canonicalName` si prendono le date di acquisto (1 per giorno), si calcola l'intervallo medio semplice in giorni; `predictedNextPurchase = ultimo acquisto + intervallo`; `isDue` quando `daysRemaining <= 0`. Servono ≥2 acquisti per una previsione (con 1 solo acquisto: `isDue=false`, `avgIntervalDays=null`, ma il prodotto resta nella risposta come "non ancora prevedibile"). `RecurringProduct.alwaysBuy` forza `isDue=true` anche con pochi dati; `intervalDays` sovrascrive la media. Una dismissal esclude il prodotto solo se più recente dell'ultimo acquisto.

## WebSocket
Endpoint `ws://<host>/ws`. Eventi server→client per il sync real-time: `transaction_update` (transazioni), `receipt_update` (scontrini), `shopping_list_update` (dismissal lista spesa).

## Struttura client (`/client/src`)
- `lib/api.js` — istanza axios (baseURL `VITE_API_URL`), interceptor: aggiunge `Bearer` token; su 401 logout + redirect `/login` **solo se era presente un token** (no logout su 401 anonimi/boot)
- `lib/constants.js` — categorie INCOME/EXPENSE, `PRODUCT_CATEGORIES` (11, per gli item scontrino), metodi pagamento + label
- `lib/format.js` — formattazione valuta EUR
- `store/authStore.js` — `{ user, token, hydrated, login, logout, loadFromStorage }` (zustand). `hydrated` evita il redirect a login durante il ripristino sessione al refresh
- `store/transactionStore.js` — `{ transactions, loading, filters, fetch/add/update/delete }`
- `store/taxStore.js` — `{ summary, items, fetchSummary, markTransferred }`
- `store/receiptStore.js` — `{ parsing, saving, parse(files), save(payload) }` (OCR → conferma → salva con createTransaction)
- `store/analyticsStore.js` — `{ byCategory, byStore, topProducts, storeComparison, trend, range, fetchAll, fetchTrend }`
- `store/shoppingListStore.js` — `{ list, recurring, fetchList, fetchRecurring, dismiss, setRecurring, removeRecurring }`
- `store/budgetStore.js` — `{ budgets, loading, fetchBudgets, saveBudget, removeBudget }`
- `lib/exportCsv.js` — genera/scarica CSV transazioni; `lib/push.js` — registrazione service worker + subscribe Web Push (VAPID)
- `hooks/useWebSocket.js` — connessione a `VITE_WS_URL`; refresh su `transaction_update`, `receipt_update` (transazioni + lista spesa + analytics se già caricate), `shopping_list_update`; riconnessione 3s
- `components/` — `PrivateRoute` (attende `hydrated`), `Layout` (nav + WS), `TransactionForm` (modal + bottone OCR), `BalanceTrendChart` (recharts), `NotificationsToggle` (attiva Web Push)
- `pages/` — `LoginPage`, `Dashboard`, `TransactionsPage`, `TaxSavingsPage`, `OcrPage` (nuova spesa da scontrino: camera/galleria, scontrino lungo multi-foto, conferma editabile), `AnalyticsPage`, `ShoppingListPage`, `BudgetsPage`, `SummaryPage`
- `public/sw.js` — service worker per le notifiche Web Push (eventi `push` + `notificationclick`)

### Routing
Pubbliche: `/login`. Protette (PrivateRoute → Layout): `/` (Dashboard), `/transactions`, `/tax-savings`, `/ocr` (Nuova spesa), `/analytics` (Analisi), `/shopping-list` (Lista spesa), `/budgets` (Budget), `/summary` (Riepilogo rapido).

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
- Variabili Railway da impostare: `DATABASE_URL` (Postgres del plugin Railway), `JWT_SECRET`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM` (mittente, opz.), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (es. `mailto:...`, per le push), `CLIENT_URL` (URL Vercel), `PORT` (Railway lo inietta), `SEED_USER*`.
  - Le chiavi VAPID si generano con `node -e "console.log(require('web-push').generateVAPIDKeys())"`.
  - Al deploy che introduce i modelli `CategoryBudget` e `PushSubscription` rieseguire `npx prisma db push` per crearne le tabelle.
- `.sh` forzato a LF via `.gitattributes` (gira su Linux anche se committato da Windows).

### Frontend → Vercel
- `client/vercel.json` con rewrite SPA (`/(.*) → /index.html`) per React Router.
- Variabili Vercel: `VITE_API_URL` (URL Railway), `VITE_WS_URL` (`wss://<railway-host>/ws`).

> Nota: si è scelto `prisma db push` invece di `prisma migrate deploy` perché non esiste un Postgres locale per autorare migration e l'app (2 utenti) non necessita di storico migration. Se in futuro servisse, generare la migration Postgres offline con `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` e committarla.
