# CasaWallet — Context

App di gestione economia domestica **multi-tenant** (famiglie/household). Nata per 2 utenti (Alessio e moglie), ora con registrazione pubblica in ottica commercializzazione (store Android/iOS via Capacitor in futuro).

## Stato avanzamento (aggiornato 4 settembre 2026)

### Completato ✅
- **DEPLOY PROD 3 set 2026 12:03 CEST** — push `457cb9c..947aadb` (F1–F8 + A/B/C + fix 401) → Railway deployment `4e7417e9` SUCCESS (db push in sync, seed 2 utenti, server+cron up), Vercel build `index-nu73WAUG.js` live su https://casa-wallet.vercel.app e punta a `casa-wallet-production.up.railway.app`. Verificato via API prod: login, `/dashboard/available`, `/recurring-rules`, `/goals`, `/forecast?days=90`, `/household` → 200 con dati vuoti per la famiglia Casa (nessun punto zero: lo imposta Alessio a mano). Prima del push: backup `pg_dump -Fc` del Postgres prod (14 tabelle) nello scratchpad della sessione. Repliche casa-wallet = 1 (us-west2), confermato da `railway status --json`.
- **Sessione "Layout & Revisione" (4 set 2026)** — 3 commit (A layout `e660418`, B revisione `b29090e`, C pronto al push `4748ba0`), ora in prod. Nessuna feature nuova.
  - **A. Navigazione mobile-first**: `components/Layout.jsx` → su < 768px bottom tab bar (Home · Movimenti · Obiettivi · Previsione · Altro) + FAB "+" (foglio: Foto scontrino → `/ocr`, Spesa manuale, Entrata → `TransactionForm`); su ≥ 768px sidebar sinistra con bottone "Nuovo". Header = titolo di pagina (mappa route in `Layout.jsx`) + avatar (tap → Impostazioni); gli `h1` delle pagine sono `sr-only`; wordmark solo in login/onboarding. Safe-area iOS (`viewport-fit=cover`, `env(safe-area-inset-bottom)`), tab bar/FAB nascosti con tastiera aperta (`visualViewport`). Icone inline SVG in `components/Icons.jsx` (nessuna libreria). FAB assente su `/ocr`, `/onboarding`, `/import`.
  - **Route**: `/movements?tab=expenses|income|recurring` (`MovementsPage` = segmented + `TransactionsPage`/`RecurringPage`), `/more` (`MorePage`: Tesoreria, Fatture, Analisi, Lista spesa, Budget, Importa CSV, Impostazioni, Esci). `/expenses`, `/income`, `/recurring`, `/transactions` → redirect a `/movements`. `/tax-savings` resta raggiungibile da Obiettivi → voce "Tasse".
  - **Dashboard a tre livelli**: (1) Disponibile reale = unico numero grande, card **neutra** (bianca) di norma, **gialla** se < 20% delle fisse mensili, **rossa** solo se < 0; sottotitolo "Saldo effettivo X"; tap → sheet con breakdown; senza punto zero e senza movimenti mostra "—" e il link al Punto zero. (2) Tre card compatte a scroll orizzontale: Obiettivi ("X € parcheggiati" + "quota di <mese> Y · versati Z"), In arrivo (netto atteso + data primo incasso), Prossima scadenza (importo + "tra N giorni"/"scaduta da N"). (3) "Il mese" comprimibile (chiuso su mobile): entrate/uscite vs mese precedente, previsione fine mese (fisse una volta sola + variabili proiettate), grafico. Card "Salvadanaio tasse" rimossa. Banner "Da confermare" per le ricorrenze con conferma manuale in attesa (sostituisce la push nella webview Capacitor).
  - **Movimenti**: totale del mese con ‹ mese › e Δ% vs precedente; Uscite = Fisse/Variabili con subtotali, righe raggruppate per giorno; riga = descrizione, categoria, importo, chip Ricorrente / Fattura n. / da obiettivo / % tasse; tap → form (con Elimina). Filtro metodo e nome membro rimossi dalla lista.
  - **Obiettivi**: riepilogo "Parcheggiati totali" + "Quota di <mese> Y · versati Z" (verde smeraldo + "in anticipo" se Z > Y, rosso se in ritardo); voce **Tasse** (personale, `totalPending`, → `/tax-savings`). **Previsione**: timeline per settimana (lun–dom) con il minimo della settimana, eventi del giorno sotto zero in rosso. **Ricorrenze**: riga tappabile + azioni testuali (Sospendi/Modifica/Elimina).
  - **Stile (A4)**: `font-variant-numeric: tabular-nums` sul body; `.text-xs`/`text-[11px]`/`text-[10px]` forzati a 13px in `index.css`; `main button`/`nav a` min-height 44px; `Segmented` 44px; tick dei grafici 13px con separatore migliaia. Verificato con Playwright (`scratchpad/pw/shots.mjs`, chromium locale) a 375/390/1280: nessun errore JS, nessun overflow, nessun testo < 13px, nessun tap target < 44px. Bundle iniziale **285 kB** (limite ~300).
  - **B. Regole confermate/documentate**:
    - *Quota mensile obiettivo*: `mesiRimanenti = ceil(giorni(oggi→data) / 30,4375)`, min 1, **mese corrente incluso** → Vacanze 3.000 al 1/8/2027 creato il 3/9/2026 = 11 mesi = 272,73 €/mese. Il wizard mostra "servono N €/mese per M mesi".
    - *SINKING ↔ ricorrenza*: **la RecurringRule crea la spesa; lo svuotamento del SINKING è un GoalContribution negativo collegato a quella Transaction** (mai una seconda uscita). Verificato: 1 sola transazione, contributo −min(saved, amount) con `transactionId`.
    - *Base della previsione*: parte dal **Disponibile reale di oggi prima delle fisse del mese** (`available + committedUntilMonthEnd`) e riapplica le fisse come eventi; etichetta mostrata in pagina. Solo eventi con data > oggi (le occorrenze di oggi sono già state postate dal cron).
    - *Saldo effettivo*: conta solo le transazioni con data ≤ oggi (una rata registrata nel futuro vive nella previsione, non nel saldo).
    - *Fisse residue del mese* (breakdown): solo occorrenze con data > oggi entro fine mese + eventuali in attesa di conferma.
    - *Ritmo obiettivi* (`paceMonthly`): versamenti ultimi 90 gg / mesi effettivamente osservati (min 1, max 3).
    - *Import CSV*: righe senza categoria → "Altro" con filtro "Da categorizzare"; accettare una ricorrenza rilevata → `POST /recurring-rules` con `linkTransactionIds` (le righe storiche prendono `recurringRuleId`, `lastPostedAt` = ultima riga, `nextRunAt` = occorrenza successiva) → finiscono in Fisse e la proposta sparisce. GPT per le righe irrisolte: **fuori**, confermato.
    - *Onboarding*: saldo iniziale obbligatorio (Salta compare dal passo 2); riparte da Impostazioni senza duplicare (mostra ciò che esiste, aggiunge solo ciò che digiti).
    - *Prestito interno*: UI in Tesoreria (non in Obiettivi); rifiuto con messaggio "massimo consentito"; Disponibile reale esclude i prestiti.
    - *WS*: `goal_update` e `recurring_update` verificati owner → member con due sessioni.
    - Test: 21/21 curl PASS (`scratchpad/test_b.sh`, riproducibile) — F1 idempotenza run-due, 31 → 30/9 e 28/2, conferma manuale, SEMIANNUAL 350, regola disattivata non tocca le transazioni; F2 categoria cambiata resta in Fisse; F3 quota 272,73, drain SINKING, chip da obiettivo, Distribuisci ≤ netto; F4 breakdown; F5 91 giorni senza duplicati; F6 guardrail + esclusione dal disponibile; F7 dedupe, mapping salvato, link retroattivo.
  - **C. Pronto al push**: `seed.js` è tornato **solo** utenti+famiglia (niente saldo, obiettivi, regole demo, famiglia "Altra"); i dati demo stanno in `prisma/seed-demo.js` (solo dev: `node prisma/seed-demo.js` dopo il seed). DB locale azzerato (backup in scratchpad) e riseminato: 2 utenti, 4 regole demo, 0 transazioni. Schema Postgres committato validato (`prisma validate`): 5 tabelle nuove (`RecurringRule`, `SavingsGoal`, `GoalContribution`, `InternalLoan`, `CategoryRule`) e sulle tabelle esistenti **solo colonne nullable** (`Transaction.recurringRuleId/importHash`, `Household.openingBalance/openingBalanceDate/csvMapping`, `FiscalProfile.maxSelfFinancePercent`) → il `prisma db push` del Dockerfile passa. **Env Railway/Vercel: nessuna variabile nuova** (`SEED_DEMO_RULES` non esiste più). **Cron: il servizio Railway deve girare su una sola replica** (i job 06:00/08:00/1° del mese sono idempotenti ma non vanno raddoppiati).
- **Sessione "Consapevolezza & Obiettivi" (3 set 2026)** — 8 feature F1–F8, un commit per feature (`96758af`..`181dd71` + fix Dashboard), tutte testate E2E via curl in locale (SQLite). **Non ancora deployate**: al push su `main` Railway fa `prisma db push` — le modifiche sono SOLO tabelle nuove e colonne nullable (verificato `prisma validate` sullo schema Postgres committato), quindi il deploy è sicuro. Concetto cardine: **Disponibile reale** = saldo effettivo − tasse accantonate non trasferite (tutti i membri) − parcheggiati negli obiettivi − uscite ricorrenti dovute entro fine mese − prestiti interni aperti.
  - **F1 Ricorrenze**: modello `RecurringRule` (scoped famiglia; type, amount, category, method, description, frequency WEEKLY|MONTHLY|BIMONTHLY|QUARTERLY|SEMIANNUAL|YEARLY, interval, dayOfMonth (31 = ultimo giorno, febbraio ok), weekday, startDate, endDate, nextRunAt, lastPostedAt, pendingAt, autoPost, active) + `Transaction.recurringRuleId?`. `lib/recurrence.js`: occorrenze deterministiche, `monthlyEquivalent` (amount/mesi), `processRule` idempotente per (regola, data) con recupero dei giorni saltati; autoPost=false → `pendingAt` + push "Conferma addebito", la transazione nasce a `POST /:id/confirm`. Cron giornaliero 06:00 Europe/Rome. Client: `/recurring`, toggle "Ripeti" nel TransactionForm (`postFirst`: la prima occorrenza nasce subito), chip "↻ Ricorrente". Le entrate ricorrenti NON creano TaxSaving. Seed: 4 regole demo con `SEED_DEMO_RULES=1` (Rata auto, Internet, Aquamea, Mutuo semestrale).
  - **F2 Entrate/Uscite**: `/expenses` e `/income` (stesso `TransactionsPage` con prop `type`), `/transactions` → redirect. Totale del mese + Δ% vs mese precedente; Uscite: blocchi Fisse (recurringRuleId) / Variabili; Entrate: badge "Fattura n. X" (GET /transactions ora include `invoice {id, numero}`) e % tasse.
  - **F3 Obiettivi**: modelli `SavingsGoal` (kind GOAL|SINKING|BUFFER, targetAmount, targetDate, startDate, priority 1..3, personal+userId, linkedRecurringRuleId) e `GoalContribution` (± importo, transactionId? per prelievi con uscita reale). `lib/goals.js`: saved, quota mensile = residuo/mesi rimanenti (SINKING collegato: quota costante `amount/mesi` della regola + `shortfall`/`catchUpQuota`), stato ON_TRACK|BEHIND|AHEAD|DONE vs traiettoria lineare per mesi (il mese corrente è fascia di tolleranza), `projectedDate` al ritmo degli ultimi 90 gg, `proposeAllocation` (SINKING per scadenza → GOAL per priorità/data → BUFFER, il resto ai BUFFER). **La scadenza di una ricorrenza collegata svuota il SINKING** (contributo negativo legato all'uscita, in `postOccurrence`). Client: `/goals` (card, wizard "servono N €/mese", Versa/Preleva, Distribuisci), `AllocateModal` proposto dopo ogni entrata (manuale o incasso fattura), card in Dashboard.
  - **F4 Disponibile reale**: `Household.openingBalance/openingBalanceDate` (PUT `/api/household/opening-balance`, qualsiasi membro), `lib/available.js` + `GET /api/dashboard/available` → `{balance, taxPending, goalsParked, committedUntilMonthEnd, committedItems, loansOutstanding, fixedMonthly, available, status OK|LOW|NEGATIVE, breakdown[]}`. Dashboard: numero grande = Disponibile reale (tap → breakdown), colore verde/giallo (<20% fisse)/rosso; sezione saldo iniziale in Impostazioni. La card "Previsione spesa fine mese" ora proietta solo le variabili e somma le fisse una volta sola.
  - **F5 Previsione 90 gg**: `lib/forecast.js` + `GET /api/forecast?days=` (7..365): parte dal libero di oggi (available + committed) e applica ricorrenze future, scadenze fiscali non pagate di tutti i membri **al netto del fondo tasse consumato in ordine di scadenza** (`coveredByFund`), incassi attesi (`computeExpectedCollections` per membro, netto), quote obiettivi (residuo oggi + 1° del mese). Ritorna `daily[]` con saldo e flag NEGATIVE/LOW, `events[]`, `minBalance/minDate/firstNegative`. Pagina `/forecast` con grafico recharts lazy e timeline.
  - **F6 Prestito interno**: modello `InternalLoan` (personale; amount, takenAt, dueDate = prossima TaxDeadline non pagata, monthlyRepayment = amount/mesi alla scadenza, repaid, status OPEN|REPAID|LATE, note, simulationVerdict) + `FiscalProfile.maxSelfFinancePercent` (default 50). `lib/loans.js`: guardrail server (verdetto OK di `simulateSelfFinancing`, amount ≤ max% × fondo − prestiti aperti, scadenza futura obbligatoria), `checkInternalLoans` nel cron 08:00 (LATE vs traiettoria lineare, rata nel giorno del prelievo, alert forte a 30 gg). Route `/api/loans`. Tesoreria: "Preleva con piano di rientro" accanto al simulatore, "di cui prestati", lista prestiti con barra e Registra rata.
  - **F7 Import CSV**: `Household.csvMapping` (JSON), `Transaction.importHash`, modello `CategoryRule` (pattern → categoria, unique per famiglia). `lib/bankImport.js`: parser tollerante (delimitatore auto, virgolette, BOM/latin1), importi "1.234,56"/"12.30"/"(12,00)", date dd/mm/yyyy|yyyy-mm-dd, hash sha1(data|importo|descrizione normalizzata) → i doppioni esatti nello stesso giorno sono considerati duplicati (limite noto), categorizzazione a regole + keyword italiane (niente AI), `detectRecurrences` (importo ±2%, giorno ±3, ≥3 mesi). Route `/api/import`: `bank-csv/preview` (multipart `file` + `mapping` JSON + `saveMapping`), `bank-csv/commit` (atomico, skip duplicati, `learn` crea la regola), `category-rules` CRUD, `recurrence-candidates`. Pagina `/import`.
  - **F8 Onboarding**: `/onboarding` in 6 passi (saldo iniziale → **estratto conto** (facoltativo: link a `/import?from=onboarding`, al termine "Torna al Punto zero" → `/onboarding?step=2`) → ricorrenze → % tasse se P.IVA → obiettivi → invito). Dashboard apre il wizard al primo accesso (nessun punto zero, nessuna transazione) una volta sola (`localStorage.onboardingSeen`); link in Impostazioni.
  - **Tooling**: `scripts/commit-schema-pg.sh` stagea la versione Postgres+enum di `schema.prisma` senza toccare l'override sqlite locale (usarlo a ogni commit che tocca lo schema). Nuovi eventi WS: `recurring_update`, `goal_update`.
  - **Non fatto / limiti**: GPT per le righe CSV irrisolte (solo keyword); Fondo agosto (BUFFER) da dimensionare dopo l'import reale; nessun deploy eseguito in questa sessione.
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
- [ ] Import PDF: provare con l'estratto conto reale di Alessio (l'euristica è stata testata solo su PDF generati)
- [ ] Configurare `OPENAI_API_KEY` (e riavviare il server) per testare l'OCR
- [ ] Task 5: deploy Railway (PostgreSQL prod) + Vercel (client)
  - **Config preparata (18 giu 2026)** — vedi sezione "Deploy (produzione)" più sotto. Deploy manuale da dashboard ancora da eseguire.
  - **Al prossimo deploy**: rieseguire `npx prisma db push` (nuove tabelle `CategoryBudget`, `PushSubscription`) e impostare le env `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (+ opz. `RESEND_FROM`); senza, push/email restano no-op.
- [ ] Task 7: test end-to-end con entrambi gli utenti + WebSocket sync reale
- [x] ~~Task 6: cron alert tasse mensile (Resend email)~~ — fatto (19 giu 2026, + Web Push)
- [x] ~~Debounce filtro anno in TransactionsPage~~ — fatto (19 giu 2026)

### Prossima sessione — note di ripartenza
- **3 set 2026, 12:03**: tutto pushato e in prod (commit `947aadb`, deployment Railway `4e7417e9`). Prossimo passo di Alessio: Punto zero in prod (saldo iniziale), poi ricorrenze reali e obiettivi. Backup pre-deploy del Postgres prod disponibile nello scratchpad (temporaneo): in futuro usare i backup del plugin Railway.
- DB locale: azzerato e riseminato (utenti seed + 4 regole demo via `node prisma/seed-demo.js`). Backup del vecchio dev.db nello scratchpad della sessione. Al primo accesso la Dashboard apre il wizard Punto zero (saldo iniziale obbligatorio).
- Strumenti: `scratchpad/pw/shots.mjs` (Playwright + chromium già presente in `~/AppData/Local/ms-playwright`) per screenshot/audit a 375/390/1280; `scratchpad/test_b.sh` per i 21 test curl. Sono fuori dal repo: ricrearli se servono.
- **3 set 2026**: F1–F8 committate su `main` ma NON pushate/deployate. Prima del push: rileggere il diff dello schema (solo aggiunte nullable/nuove tabelle → `prisma db push` in Dockerfile passa). Il dev.db locale contiene dati di prova (opening balance 5000 al 1/9, obiettivi Vacanze/Mutuo/Fondo agosto, 4 regole demo, un account "Altra" famiglia `altro-f1@test.local`) — non sono in prod.
- Per committare lo schema: `bash scripts/commit-schema-pg.sh` (stagea la versione Postgres), poi `git add` del resto. Il file locale resta sqlite.
- Avvio locale: `cd server && npm run dev` (porta 3001) e `cd client && npm run dev` (5173). Seed con regole demo: `SEED_DEMO_RULES=1 node prisma/seed.js`.
- Idee lasciate aperte: GPT per righe CSV irrisolte; dimensionare "Fondo agosto" dopo l'import reale; push native FCM per Capacitor; email digest settimanale del Disponibile reale.
- Working tree locale: `schema.prisma` in versione SQLite (provider sqlite + `type`/`method` String) — override **non committato**, come da strategia dual-provider. La versione committata è postgres+enum CON le modifiche household.
- Per riavviare l'ambiente locale: `cd server && npm run dev` (DB SQLite `dev.db` migrato con household e popolato dal seed).
- Roadmap concordata (6 lug 2026): ① redesign UI stile home banking (task in corso) → ② motore di tesoreria (scadenze fiscali, simulatore auto-finanziamento, % minima suggerita con avviso se la % utente è sotto) → ③ import FatturaPA XML + connettori Aruba e Fattura24 (gestionale della moglie) → ④ Capacitor per store Android/iOS + in-app purchase → ⑤ home banking (open banking PSD2, es. GoCardless).

## Guida utente (PDF) — `npm run docs:guide`
- Sorgente `docs/guide/guide.md` (voce "tu", niente termini tecnici: "spesa periodica"/"cuscinetto", mai SINKING/BUFFER) + `docs/guide/template.html` (A4 verticale, un capitolo per pagina: testo a sinistra, telefono a destra). Output `docs/Guida_Awareness.pdf` (19 pagine) copiato in `client/public/Guida_Awareness.pdf` → voce **Guida** in Impostazioni (`/Guida_Awareness.pdf`).
- Pipeline `scripts/guide/generate.mjs` (root `package.json`: devDeps `playwright`, `marked`; `npm run docs:guide:install` scarica chromium se manca, oppure env `CHROME=<path chrome.exe>`): crea `server/prisma/guide.db` (mai `dev.db`), `prisma db push` + `prisma/seed-demo.js` (famiglia "Demo": Anna/Marco `@demo.local`, password `demo1234`, saldo iniziale, 4 ricorrenze, 3 obiettivi, entrate con tasse, scontrini di 2 negozi, budget, scadenza, fattura in attesa), avvia server `:3011` e vite `:5183`, cattura 18 schermate a 390×844 in `docs/guide/img/` (OCR mockato via `page.route` con `fixtures/scontrino.png`, CSV da `fixtures/estratto.csv`), genera il PDF con `page.pdf`.
- Flag: `--skip-seed` (riusa guide.db), `--shots-only`, `--pdf-only`, `--keep-html`. **Prod**: `--base-url=https://casa-wallet.vercel.app --api-url=https://casa-wallet-production.up.railway.app --email=… --password=…` salta seed/server e le schermate `sensitive` (punto-zero, tesoreria, fatture, impostazioni), che restano quelle già in `img/`.
- `seed-demo.js` NON è eseguito dal Dockerfile; ricrea da zero la famiglia "Demo" se esiste (idempotente).

## Icona app — `npm run icons`
- Sorgente `client/public/favicon.svg` (portafoglio bianco su verde brand-600 `#0a6847`, angoli arrotondati). `scripts/icons/generate.mjs` (Playwright) produce `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon.png` in `client/public` e i mipmap Android (`ic_launcher`, `ic_launcher_round`, `ic_launcher_foreground` per densità) + `values/ic_launcher_background.xml` verde. `index.html`: link icon/apple-touch-icon/manifest, `theme-color`, meta iOS web-app. `public/manifest.webmanifest` (standalone, verde) → "Aggiungi a schermata Home" mostra l'icona. Per l'APK: `npx cap sync android` e rebuild.

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
- `POST /reset` body `{ confirm: "RICOMINCIA" }` → **ricomincia da capo** (solo OWNER, 400 senza la parola): cancella tutti i dati economici della famiglia e dei membri (movimenti, tax saving, scontrini, ricorrenze, obiettivi, budget, regole CSV, prodotti ricorrenti, fatture, scadenze, prestiti, profili fiscali, connessione Aruba, saldo iniziale, mapping CSV); restano account, famiglia, codice invito, push subscription. Voce "Ricomincia da capo" in Altro → riapre il Punto zero

### Transactions (`/api/transactions`) — protette
- `POST /` → crea transazione; se `type=INCOME` e `taxPercent>0` crea anche il TaxSaving collegato
- `GET /?month=&year=&type=&category=&method=` → lista filtrata (il filtro data richiede almeno `year`); include `taxSaving`, `user {id,name}`, `invoice {id,numero}`, `goalContribution {id,goalId}`
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

### Ricorrenze (`/api/recurring-rules`) — protette, scoped famiglia
- `GET /?active=true` → `{ rules: [...+monthlyEquivalent, monthsPerOccurrence], monthlyFixedExpense, monthlyFixedIncome }`
- `POST /` body `{ type, amount, category, method, description?, frequency, interval?, dayOfMonth?, weekday?, startDate, endDate?, autoPost?, postFirst?, linkTransactionIds? }` → 201 (la regola viene processata subito: se dovuta, la transazione nasce o va in attesa); `postFirst` parte dalla startDate anche se passata; `linkTransactionIds` (import CSV) collega retroattivamente le transazioni della famiglia alla regola e parte dall'occorrenza successiva all'ultima collegata
- `PUT /:id` (update parziale, ricalcola nextRunAt mai nel passato), `DELETE /:id` (le transazioni restano, link a null)
- `GET /upcoming?days=90` → `{ events: [{ruleId, date, type, amount, category, description, autoPost, pending}] }` materializzate, non salvate
- `POST /run-due {force?}` (test del cron, solo la propria famiglia), `POST /:id/confirm {amount?, date?}` (409 se nulla in attesa), `POST /:id/skip`
- WS `recurring_update`; le transazioni create dal cron emettono `transaction_update`

### Obiettivi (`/api/goals`) — protette, condivisi (personal=true → solo il proprietario)
- `GET /?includeInactive=` → `{ goals: [...saved, target, remaining, dueDate, monthsRemaining, monthlyQuota, shortfall, catchUpQuota, monthContributed, monthRemaining, paceMonthly, projectedDate, status, progress], summary: {count, parked, monthQuota, monthContributed, behind} }`
- `POST /` body `{ name, kind?, icon?, targetAmount, targetDate? (obbligatoria per GOAL), priority?, personal?, linkedRecurringRuleId? }` (con regola collegata name/target/kind si deducono); `PUT /:id`; `DELETE /:id` (contributi in cascade)
- `GET /:id/contributions`; `POST /:id/contribute { amount (±), date?, note?, createTransaction?, category?, method? }` (400 se prelievo > saved)
- `POST /allocate { amount? | incomeTransactionId? }` → proposta senza scritture `{ amount, allocations[{goalId, amount, ...}], unallocated, source }`; `POST /allocate/confirm { allocations[{goalId, amount}], date?, note? }` → contributi atomici
- WS `goal_update`

### Dashboard / previsione
- `GET /api/dashboard/available` → Disponibile reale con `breakdown[]` e `committedItems[]`
- `GET /api/forecast?days=90` → `{ startBalance, threshold, endBalance, minBalance, minDate, firstNegative, daysNegative, daysLow, totals, events[], daily[{date, delta, balance, flag, events?}] }`
- `PUT /api/household/opening-balance { openingBalance|null, openingBalanceDate? }` (qualsiasi membro); `GET /api/household` ora include `openingBalance/openingBalanceDate`

### Prestiti interni (`/api/loans`) — protette, PERSONALI
- `GET /?includeClosed=` → `{ loans[...outstanding, expectedRepaidByNow, behindBy, progress, daysToDue, suggestedRepayment], outstanding, openCount, fundAvailable, maxPercent, cap }`
- `POST / { amount, note?, scope? }` → 201 oppure 400 `{ error, code: VERDICT|CAP|NO_DEADLINE|DATI_INSUFFICIENTI, cap?, maxPercent? }`
- `POST /:id/repay { amount }` (→ REPAID al saldo), `DELETE /:id` (409 se rate già rientrate), `POST /check {force?}` (test del controllo giornaliero)
- `PUT /api/treasury/fiscal-profile` accetta anche `maxSelfFinancePercent`

### Import estratto conto (`/api/import`) — protette, scoped famiglia
- **Formati** (`lib/statementParsers.js`, rilevati dal contenuto): CSV; Excel xls/xlsx e Excel-XML (SheetJS, foglio più lungo, preambolo tagliato da `trimToTable`); XML ISO 20022 camt.052/053 (→ colonne fisse Data/Descrizione/Importo, `autoMapping`); XML CBI/tabellare generico (chiavi → intestazioni, colonna "Importo con segno" da Segno D/C); PDF (pdf.js con coordinate: righe per Y, segno da segno esplicito → saldo progressivo → colonna Dare/Avere dell'intestazione più vicina in X, continuazioni descrizione; `autoMapping`; PDF scansionati → 400). La response ha `format` e `autoMapped` (true → il client salta la mappa colonne e il mapping CSV salvato non viene toccato). Limite file 15 MB.
- `POST /bank-csv/preview` multipart `file` (+ `mapping` JSON `{dateCol, descCol, amountCol | debitCol+creditCol, hasHeader?, invertSign?}` indici colonna, `saveMapping=true`) → `{ delimiter, headers, sample, totalRows, savedMapping, mapping, parsed: null | [{line, date, amount, type, description, hash, duplicate, category, categorySource, error?}], stats }`
- `POST /bank-csv/commit { rows[{date, amount, type, description, category, hash?, method?, learn?}], method? }` → `{ created, skipped, errors }` (max 2000 righe)
- `GET /category-rules`, `POST /category-rules {pattern, category, type?}`, `DELETE /category-rules/:id`
- `GET /recurrence-candidates?months=12` → `{ proposals[{description, type, category, amount, dayOfMonth, months, lastDate, transactionIds}] }` (esclude quelle già coperte da una regola: stessa descrizione normalizzata, o stesso tipo + importo ±2% + giorno ±3)

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
Endpoint `ws://<host>/ws?token=<jwt>` — connessione autenticata (senza/invalid token → close 4401). Eventi server→client scoped per famiglia: `transaction_update`, `receipt_update`, `shopping_list_update`, `invoice_update`, `recurring_update`, `goal_update`.

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
- `store/recurringStore.js` — `{ rules, monthlyFixedExpense, monthlyFixedIncome, loaded, fetchRules, createRule, updateRule, deleteRule, confirmPending, skipPending }`
- `store/goalStore.js` — `{ goals, summary, loaded, fetchGoals, createGoal, updateGoal, deleteGoal, contribute, propose, confirmAllocation }`
- `store/treasuryStore.js` — ora anche `{ loans, fetchLoans, createLoan, repayLoan, cancelLoan }`; `store/householdStore.js` — anche `setOpeningBalance`
- `lib/exportCsv.js` — genera/scarica CSV transazioni; `lib/push.js` — registrazione service worker + subscribe Web Push (VAPID)
- `hooks/useWebSocket.js` — connessione a `VITE_WS_URL`; refresh su `transaction_update`, `receipt_update` (transazioni + lista spesa + analytics se già caricate), `shopping_list_update`; riconnessione 3s
- `components/` — `PrivateRoute` (attende `hydrated`), `Layout` (nav + WS), `TransactionForm` (modal + bottone OCR + toggle Ripeti + proposta riparto dopo un'entrata), `RecurrenceFields` (campi pianificazione condivisi), `AllocateModal` (Distribuisci), `BalanceTrendChart`/`ForecastChart` (recharts, lazy), `NotificationsToggle` (attiva Web Push)
- `pages/` — `LoginPage`, `Dashboard`, `TransactionsPage` (prop `type`: Uscite/Entrate), `RecurringPage`, `GoalsPage`, `ForecastPage`, `ImportPage`, `OnboardingPage`, `TaxSavingsPage`, `TreasuryPage`, `InvoicesPage`, `OcrPage`, `AnalyticsPage`, `ShoppingListPage`, `BudgetsPage`, `SummaryPage`, `SettingsPage`
- `public/sw.js` — service worker per le notifiche Web Push (eventi `push` + `notificationclick`)

### Routing
Pubbliche: `/login`, `/register`. Protette (PrivateRoute → Layout): `/` (Home/Dashboard), `/movements?tab=expenses|income|recurring` (Movimenti), `/goals` (Obiettivi, con voce Tasse), `/forecast` (Previsione), `/more` (Altro), `/tax-savings`, `/treasury` (Tesoreria), `/invoices` (Fatture), `/ocr` (Nuova spesa), `/import` (Importa CSV), `/analytics` (Analisi), `/shopping-list` (Lista spesa), `/budgets` (Budget), `/summary` (Riepilogo rapido), `/settings` (Impostazioni famiglia), `/onboarding` (Punto zero). Redirect: `/expenses`, `/income`, `/recurring`, `/transactions` → `/movements`. Nav: tab bar mobile (5 voci) + FAB, sidebar desktop — vedi `components/Layout.jsx`.

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
