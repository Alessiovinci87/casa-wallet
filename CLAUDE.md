# CasaWallet — Context

App di gestione economia domestica **multi-tenant** (famiglie/household). Nata per 2 utenti (Alessio e moglie), ora con registrazione pubblica in ottica commercializzazione (store Android/iOS via Capacitor in futuro).

## Stato avanzamento (aggiornato 14 luglio 2026)

### Completato ✅
- **6 nuove funzionalità (14 lug 2026)** — commit `f7ddab9`, live (Railway+Vercel+APK). Testato E2E in locale (stima al centesimo, verify-email flusso completo, alert soglia, generate idempotente)
  - **Stima pagamenti 30/6 e 30/11**: `lib/taxEstimate.js` (metodo storico su fatture INCASSATE: dovuto(Y)=imponibile×coeff×(imposta+INPS); giugno=saldo+1°acconto, novembre=2°acconto; acconti versati≈dovuto(Y−2)); `GET /api/treasury/tax-estimate?year=` (`noHistory` se 0 incassi anno prec.); sezione in Tesoreria con proiezione anno corrente (incassato+fatture attese)
  - **Scadenze precompilate**: `POST /api/deadlines/generate {year?}` → crea 30/6 (IRPEF_SALDO) e 30/11 (IRPEF_ACCONTO) dagli importi stimati, idempotente per type+anno; bottone "Crea scadenze da stima"
  - **Incassi attesi in Dashboard**: `GET /api/treasury/expected-collections` (JSON `null` se nessuna fattura in attesa — attenzione in PowerShell: `.Count` su scalare vale 1) + card "In arrivo" → /invoices
  - **Verifica email** (non bloccante): `User.emailVerifiedAt`+`emailVerifyToken` (unique), register invia link Resend (fire-and-forget), `GET /api/auth/verify-email?token=` (pagina HTML, token monouso), `POST /api/auth/resend-verification` (409 se già verificata), `publicUser.emailVerified` in login/register/me, banner in Dashboard con "Reinvia"; seed marca verificati i 2 account storici. **Dockerfile: aggiunto `--accept-data-loss` a db push** (senza, qualunque warning manda il deploy container in crash-loop)
  - **Riconciliazione fattura↔incasso**: TransactionForm su INCOME carica le fatture EMESSA; se importo entro 1% del netToPay → banner "È l'incasso della fattura n. X?" con bottone che chiama `PUT /invoices/:id/collect` (metodo/data/% dal form) invece di creare l'entrata manuale
  - **Export fiscale**: `GET /api/treasury/fiscal-report?year=` (fatture incassate nell'anno + totali + accantonato/trasferito + stima dovuto) + CSV client (`fiscalReportToCsv`) in Tesoreria, bottoni anno corrente/precedente
  - **Alert spesa insolita**: `lib/spendAlert.js` su POST transaction EXPENSE (fire-and-forget): se il totale mese della categoria attraversa 1.5× la media storica (≥3 mesi con dati, min 50€) → push alla famiglia; l'attraversamento evita alert ripetuti
- **Incassi attesi nel simulatore + refinement generale (14 lug 2026)** — commit `1aac656`, deployato (Railway+Vercel+APK)
  - Tesoreria: `computeExpectedCollections` in `lib/treasury.js` — fatture EMESSE come incassi attesi (data stimata: dueDate o date+ritardo mediano storico su ≥3 incassi, default 45gg; netto = netToPay × (1−defaultTaxPercent)); scenari realistico/ottimista li cumulano mese per mese (`monthsToRepayWithCollections`), pessimista li esclude. Response simulate: `expectedCollections {count, gross, net, taxPercent, delayDays, delaySource, nextExpectedAt}` + `withCollections` per scenario; card dedicata in TreasuryPage
  - Hardening server: rate limit login/register (20/15min, `trust proxy` per Railway), fail-fast `JWT_SECRET` all'avvio (warn se manca INVOICE_CRED_SECRET), error handler JSON globale (CORS→403), validazione amount/date/taxPercent su POST/PUT transactions, email `trim().toLowerCase()` in register/login, P2002→409, CORS vercel ristretto a `casa-wallet*.vercel.app`, `@@index([receiptId])`+`@@index([canonicalName])` su ReceiptItem (applicati anche al dev.db)
  - Fix client: bottone 📷 OCR nel TransactionForm era SEMPRE rotto (inviava campo `image`, multer si aspetta `images`); conferma + gestione errore su elimina transazione; code splitting route lazy + recharts lazy → bundle iniziale 725KB→~300KB
  - Non fatto (valutato, rimandato): WS token in query string (cambio protocollo), refetch ridondante post-mutazione (WS broadcast include il mittente), stato errore negli store client, PRODUCT_CATEGORIES duplicata client/server
- **Capacitor Android — primo APK debug (13 lug 2026)** — commit `508e733`
  - `client/capacitor.config.json` (appId `com.casawallet.app`, webDir `dist`) + progetto nativo `client/android/` committato
  - `client/.env.production` con URL Railway → le build native puntano alla prod (le env Vercel hanno comunque precedenza in build cloud)
  - CORS server: aggiunte le origini webview Capacitor (`https://localhost`, `http://localhost`, `capacitor://localhost`) — deployato e verificato con preflight
  - Toolchain locale senza admin: JDK 21 portable `C:\Users\aless\dev-tools\jdk-21`, Android SDK `C:\Users\aless\dev-tools\android-sdk` (android-35, build-tools 35); `client/android/local.properties` (gitignored) punta all'SDK
  - Rebuild: in `/client` `npm run build && npx cap sync android`, poi in `/client/android` con `JAVA_HOME` al JDK portable: `.\gradlew.bat assembleDebug` → `android/app/build/outputs/apk/debug/app-debug.apk`
  - Resta per lo store: icona/splash (da `client/public/favicon.svg` via @capacitor/assets), push native FCM (Web Push non funziona in webview, già guardato da `pushSupported()`), keystore + AAB release, account Google Play; iOS richiede un Mac
- **Azioni prod chiuse (13 lug 2026)**: `INVOICE_CRED_SECRET` impostata su Railway (via CLI, progetto `vibrant-gratitude`/servizio `casa-wallet`); prod verificata E2E via API (register+login+JWT, account di test `test-claude-20260713@casawallet.local` da rimuovere col reset pre-lancio). NB: password seed prod = env Railway, diversa da quella locale
- **Fatture elettroniche: import FatturaPA XML + connettore Aruba (6 lug 2026)** — testato E2E (parser 33/33, route 17/17)
  - Modelli `Invoice` (PERSONALE: numero+year dedupe `@@unique([userId,numero,year])`, importi imponibile/iva/ritenuta/cassa/bollo/grossTotal/netToPay, status EMESSA|INCASSATA, link 1:1 a Transaction) e `ArubaConnection` (credenziali cifrate AES-256-GCM, chiave env `INVOICE_CRED_SECRET`); `FiscalProfile.partitaIva` (verifica proprietà fatture)
  - `lib/fatturapa.js`: parser puro namespace-agnostic (fast-xml-parser, aritmetica in centesimi), multi-body (lotto), totali SEMPRE da DatiRiepilogo (`ImportoTotaleDocumento` è opzionale), netto = imponibile+iva+bollo−ritenuta, cross-check pagamenti→warning; `sniffP7m` (p7m rifiutati in v1); TD04/divisa≠EUR → skip
  - **Regime di cassa**: l'import crea la fattura "in attesa"; l'entrata (+TaxSaving con % dal profilo fiscale) nasce solo al `PUT /collect`; `uncollect` reverte tutto atomicamente
  - Blocco P.IVA: fattura con emittente ≠ partitaIva utente → errore (evita import di fatture ricevute)
  - `lib/arubaClient.js`: signin con token cache 25min (rate limit 1/min!), list v2 invoices-out paginata + incrementale via modifiedStartDate, XML base64 da getByFilename → stesso parser. Sync manuale (cron v2)
  - **Fattura24 (gestionale moglie): API solo scrittura → connettore impossibile (ricerca 6 lug)** — lei usa l'upload XML; in futuro valutare Fatture in Cloud (API completa con stato incassi)
  - Client: pagina `/invoices` "Fatture" (upload multiplo, lista con badge/warning, modal incasso con anteprima accantonamento, card connettore Aruba), `invoiceStore`, categoria INCOME "Fatture", campo P.IVA in TreasuryPage, evento WS `invoice_update`
- **Motore di Tesoreria (6 lug 2026)** — feature chiave P.IVA, testato E2E (32/32 PASS)
  - Modelli `TaxDeadline` (scadenza fiscale PERSONALE: name, type String IRPEF_SALDO|IRPEF_ACCONTO|IVA|INPS|ALTRO, dueDate, expectedAmount, paid/paidAt) e `FiscalProfile` (1:1 User: regime String FORFETTARIO|ORDINARIO|ALTRO, coeffRedditivita, aliquotaImposta, aliquotaInps, defaultTaxPercent)
  - `server/src/lib/treasury.js`: `buildFinancialProfile` (finestra 12 mesi pieni, bucket mensili, percentili p25/p50/p75 della capacità = entrate − tasse accantonate − quota spese, buffer sicurezza 10%, rilevamento spese ricorrenti ≥75% mesi + CV≤0.35, aliquota effettiva) e `simulateSelfFinancing` (fondo disponibile, 3 scenari, verdetti OK/RISCHIO/NO vs prossima scadenza: OK se rientro ≤ dueDate, RISCHIO entro +1 mese). Scope "user" (default: quota equa spese famiglia = /n membri) o "household". `computeSuggestedMinPercent` = ceil(coeff × (imposta+INPS)); warning NON bloccante se defaultTaxPercent < minima. Matematica deterministica, no AI. <3 mesi dati → `{ok:false, reason:"DATI_INSUFFICIENTI"}` (200)
  - `lib/deadlineReminder.js` + cron giornaliero 08:00 Europe/Rome: promemoria email+push a 30/7/1 giorni (day-match stateless, no duplicati); trigger test `POST /api/deadlines/send-reminders {force?}`
  - Client: pagina `/treasury` "Tesoreria" (scadenze CRUD, profilo finanziario con toggle Solo io/Famiglia, simulatore con verdetti colorati, profilo fiscale con warning % minima), `treasuryStore` (fiscalProfile cached), prefill `taxPercent` nel TransactionForm da `defaultTaxPercent` (solo creazione, mai sovrascrive), card "Prossima scadenza" in Dashboard (entro 60 gg)
- **Multi-tenant / Household (6 lug 2026)** — refactoring completo, testato E2E (36/36 PASS + 3/3 WS)
  - Modello `Household` (name, inviteCode univoco 8 char); `User.householdId` + `role` String ("OWNER"|"MEMBER", validato in API — niente enum per il vincolo dual-provider)
  - `Transaction`/`Receipt`: `householdId` denormalizzato + `@@index([householdId, date])`; `RecurringProduct`/`ShoppingListDismissal`/`CategoryBudget`: scoped per famiglia (`userId` → `householdId`); `TaxSaving` PERSONALE via `transaction.userId`; modello `Alert` rimosso (dead code)
  - `POST /api/auth/register`: crea famiglia (OWNER) XOR join con codice invito (MEMBER); JWT con claim `householdId`+`role`; token vecchi senza claim → 401
  - Route `/api/household`: GET info+membri, PUT rename e POST regenerate-invite (solo OWNER)
  - Tutte le query scoped per famiglia; mutazioni `:id` con ownership check (404 fuori famiglia). Chiuse 4 falle: mutazioni cross-user, link transactionId arbitrario, unsubscribe push altrui, WS senza auth
  - WS autenticato (`/ws?token=`, close 4401), `broadcast(householdId, msg)` solo alla famiglia; relay client→client rimosso
  - Push: `sendPushToUser`/`sendPushToHousehold` (via `user.householdId`); alert tasse per-utente (`sendTaxAlertForUser`/`sendTaxAlerts`), cron aggiornato
  - Client: `RegisterPage` (tab crea/unisciti), `SettingsPage` (/settings: nome famiglia, membri, codice invito copia/rigenera), `householdStore`, WS con token, chip nome membro sulle transazioni
  - Seed: household "Casa" + 2 utenti (user1 OWNER, user2 MEMBER), idempotente
  - `server/package.json` dev script: `--watch-path=./src` (il watch su tutta la cartella riavviava il server a ogni scrittura SQLite)
  - Decisioni prodotto confermate: codice invito (no email), verifica email pre-lancio store, dati condivisi in famiglia MA salvadanaio tasse personale
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
- Working tree locale: `schema.prisma` in versione SQLite (provider sqlite + `type`/`method` String) — override **non committato**, come da strategia dual-provider. La versione committata è postgres+enum CON le modifiche household.
- Per riavviare l'ambiente locale: `cd server && npm run dev` (DB SQLite `dev.db` migrato con household e popolato dal seed).
- Roadmap concordata (6 lug 2026): ① redesign UI stile home banking (task in corso) → ② motore di tesoreria (scadenze fiscali, simulatore auto-finanziamento, % minima suggerita con avviso se la % utente è sotto) → ③ import FatturaPA XML + connettori Aruba e Fattura24 (gestionale della moglie) → ④ Capacitor per store Android/iOS + in-app purchase → ⑤ home banking (open banking PSD2, es. GoCardless).

## Stack
- /client: React + Vite + Tailwind → Vercel
- /server: Node + Express + Prisma + PostgreSQL → Railway

## Utenti / Tenancy
Registrazione pubblica: chi si registra crea una famiglia (diventa OWNER) o entra in una esistente col codice invito (MEMBER). Tutti i dati sono condivisi dentro la famiglia, tranne il salvadanaio tasse (personale per utente). Il seed crea la famiglia "Casa" con i 2 account storici.

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
- `POST /register` → body `{ name, email, password, householdName? XOR inviteCode? }` → 201 `{ token, user, household: {id, name, inviteCode} }`. Errori: 400 (campi/password<8/XOR), 409 (email esistente), 404 (codice invito)
- `POST /login` → `{ token, user: {id, name, email, householdId, role} }`
- `POST /refresh` → rinnova il token rileggendo l'utente dal DB (claims freschi)
- `GET /me` → utente corrente
- JWT payload: `{ sub, email, name, householdId, role }`; token senza `householdId` → 401 ovunque

### Household (`/api/household`) — protette
- `GET /` → `{ id, name, inviteCode, createdAt, members: [{id, name, email, role, createdAt}] }`
- `PUT /` body `{ name }` → rename (403 se non OWNER)
- `POST /regenerate-invite` → nuovo codice, il vecchio muore (403 se non OWNER)

### Transactions (`/api/transactions`) — protette
- `POST /` → crea transazione; se `type=INCOME` e `taxPercent>0` crea anche il TaxSaving collegato
- `GET /?month=&year=&type=&category=&method=` → lista filtrata (il filtro data richiede almeno `year`)
- `PUT /:id` → modifica (riallinea il TaxSaving)
- `DELETE /:id` → elimina (rimuove anche il TaxSaving collegato)
- Ogni POST/PUT/DELETE → broadcast WebSocket: `{ event: "transaction_update", payload: { action, transaction } }`

### Tax Savings (`/api/tax-savings`) — protette, PERSONALI (solo i propri, via transaction.userId)
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

### Scadenze fiscali (`/api/deadlines`) — protette, PERSONALI
- `GET /?includePaid=false` → scadenze dell'utente ordinate per data, arricchite con `daysUntil` e `overdue`
- `POST /` body `{ name, type, dueDate, expectedAmount }` → 201 (400 su type fuori set / amount ≤0; data passata ammessa)
- `PUT /:id` → update parziale + `paid` (true → `paidAt`); `DELETE /:id`; ownership 404
- `POST /send-reminders` body `{ force? }` → invia subito i promemoria del chiamante (test; il cron giornaliero 08:00 li manda a 30/7/1 giorni)

### Tesoreria (`/api/treasury`) — protette
- `GET /profile?scope=user|household&months=3..24&buffer=0..0.5` → profilo finanziario (percentili capacità, spese ricorrenti, aliquota effettiva) o `{ok:false, reason:"DATI_INSUFFICIENTI"}`
- `POST /simulate` body `{ amount, scope? }` → fondo disponibile, 3 scenari (pessimista/realistico/ottimista) con verdetti OK/RISCHIO/NO vs prossima scadenza, `overallVerdict`, `expectedCollections` (fatture EMESSE come incassi attesi: contano in realistico/ottimista, esclusi dal pessimista), disclaimer
- `GET /fiscal-profile` → `{ profile, suggestedMinPercent, belowSuggested }`
- `PUT /fiscal-profile` body `{ regime, coeffRedditivita?, aliquotaImposta?, aliquotaInps?, defaultTaxPercent? }` → upsert, stesso shape del GET (warning % mai bloccante)

### Fatture elettroniche (`/api/invoices`) — protette, PERSONALI
- `POST /import-xml` → multipart campo `files` (1..20 XML FatturaPA) → `{ imported[], skipped[{file,numero?,reason}], errors[{file,error}], warning? }`. p7m → error; TD∉{TD01,TD06,TD24,TD25} o divisa≠EUR → skip; P.IVA emittente ≠ `fiscalProfile.partitaIva` → error bloccante; dedupe su userId+numero+year → skip
- `GET /?status=&year=` → fatture dell'utente (include transaction leggera)
- `PUT /:id/collect` body `{ taxPercent?, method?, date? }` → crea l'entrata INCOME (amount=netToPay, categoria "Fatture", % dal body o dal profilo fiscale, TaxSaving nested) + stato INCASSATA, atomico; 409 se già incassata
- `PUT /:id/uncollect` → elimina transazione+TaxSaving e torna EMESSA; `DELETE /:id` solo su EMESSA (409 altrimenti)
- `GET /aruba` (stato), `POST /aruba/connect {username,password}` (valida con signin reale, salva cifrato), `DELETE /aruba/connect`, `POST /aruba/sync` (incrementale da lastSyncAt, skip Scartata) → `{ imported, skipped, errors }`
- Env richiesta per il connettore: `INVOICE_CRED_SECRET`

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
Endpoint `ws://<host>/ws?token=<jwt>` — connessione autenticata (senza/invalid token → close 4401). Eventi server→client scoped per famiglia: `transaction_update`, `receipt_update`, `shopping_list_update`.

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
Pubbliche: `/login`, `/register`. Protette (PrivateRoute → Layout): `/` (Dashboard), `/transactions`, `/tax-savings`, `/treasury` (Tesoreria), `/invoices` (Fatture), `/ocr` (Nuova spesa), `/analytics` (Analisi), `/shopping-list` (Lista spesa), `/budgets` (Budget), `/summary` (Riepilogo rapido), `/settings` (Impostazioni famiglia).

### Env client
`VITE_API_URL`, `VITE_WS_URL` — vedi `/client/.env.example`.

## Deploy (produzione)

> Il deploy si fa manualmente dalle dashboard Railway e Vercel. I file di config sono già pronti nel repo.

### Schema / provider — strategia dual-provider
- **Committato (`origin/main`)**: `schema.prisma` con `provider = "postgresql"` + enum veri `TxType`/`PayMethod`. È la **sorgente di verità per la produzione**.
- **Locale (dev)**: `schema.prisma` viene tenuto modificato a `provider = "sqlite"` + `type`/`method` come `String` — **modifica non committata** apposta. Idem la cartella `server/prisma/migrations/` e `dev.db`: locali, ignorati da git (`.gitignore`). Non committare l'override sqlite, romperebbe la prod.

### Backend → Railway
- **ATTENZIONE: Railway builda col `Dockerfile` alla RADICE del repo** (non Nixpacks: `server/Procfile` e `server/railway.json` sono vestigiali) e fa **AUTO-DEPLOY a ogni push su `main`**. Il CMD esegue `prisma db push && seed && node src/index.js` → uno schema con modifiche breaking (colonne required su tabelle piene) BLOCCA la prod in loop (successo il 6 lug 2026 col multi-tenant: risolto con reset del DB prod). In futuro valutare `migrate deploy`.
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
