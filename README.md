# Sharework

Web app per progetti PDF condivisi, con registrazione, accesso e approvazione dell'amministratore. Tutti gli utenti approvati vedono tutti i progetti. Nessun documento è accessibile senza autenticazione e approvazione.

## Funzioni

- Importazione PDF (massimo 50 MB) in Supabase Storage privato.
- Note numerate per progetto, quattro forme, tavolozza colori.
- Evidenziatore libero con spessore in coordinate PDF e trasparenza.
- Titolo e descrizione salvati automaticamente, nome autore e data assegnati dal database.
- Zoom con rendering della zona visibile, pannelli riducibili e ridimensionabili.
- Filtro Pagina/Tutte con separatori; selettore rapido delle pagine.
- Annulla/Ripeti e controllo versione per rilevare modifiche concorrenti.
- Aggiornamento annotazioni condivise ogni 10 secondi (non durante l'editing).
- Area amministratore per approvare e disabilitare utenti.

## Avvio

Node.js 22 o successivo. Dipendenze fissate nel lockfile.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm dev
```

L'anteprima usa `http://127.0.0.1:4173`. `dist` è il sito statico da pubblicare.

## Configurazione Supabase

1. Nel SQL Editor del progetto eseguire **una sola volta** `supabase/001_sharework.sql`. La migrazione è transazionale e non modifica le tabelle di altre applicazioni. Se esistono già oggetti `sw_*`, fermarsi e controllare lo schema prima di ripeterla.
2. In Authentication abilitare Email, registrazioni e conferma email. Lasciare disabilitato l'accesso anonimo.
3. Configurare un proprio SMTP per inviti, conferma email e recupero password. Il servizio di prova Supabase non è adatto agli utenti esterni al team del progetto.
4. In URL Configuration impostare il dominio definitivo come Site URL e aggiungerlo agli URL di redirect consentiti, includendo il percorso esatto dell'app.
5. Registrare il primo amministratore dall'app e confermare la sua email.
6. In `002_first_admin.sql` sostituire il segnaposto con l'email dell'amministratore e eseguirlo nel SQL Editor. Il controllo richiede email confermata. Non pubblicare una versione compilata con credenziali amministrative.
7. I nuovi utenti rimangono in attesa: l'amministratore li abilita dalla pagina Utenti. La registrazione da sola non concede accesso ai documenti.

`src/config.js` contiene l'URL e la sola chiave pubblica/publishable, utilizzabile nel browser. Non inserire `service_role`, secret key o password nel repository. Tutte le autorizzazioni sono applicate anche nel database e nello Storage; il nome autore non dipende dal contenuto inviato dal browser.

## Pubblicazione Cloudflare Pages

Collegare questo repository a un progetto Pages, scegliere ramo `main`, comando di build `pnpm install --frozen-lockfile && pnpm build`, directory di output `dist`, Node 22+. In alternativa caricare il contenuto della cartella `dist` come sito statico. Gli header di sicurezza sono in `src/_headers` e vengono copiati nella build.

Il sito pubblico mostra solo l'accesso. I PDF non si trovano nel repository o nella cartella pubblicata: sono nel bucket privato `sharework-pdfs`. Dopo il login vengono scaricati con il token dell'utente, senza URL pubblici permanenti.

## Verifiche e limiti

`pnpm test` esegue veri test SQL su PostgreSQL locale tramite PGlite, con ruoli e Row Level Security: accesso negato ai non approvati, impossibilità di auto-approvazione, identità autore non falsificabile, numerazione, controllo versione e file privati. PGlite simula le tabelle Auth/Storage necessarie; non sostituisce il collaudo dei servizi Auth/Storage sul progetto Supabase reale.

La build e i test non eseguono la migrazione sul progetto remoto. Prima dell'uso operativo collaudare con due account: registrazione/conferma, approvazione, importazione PDF, modifiche concorrenti, revoca accesso e recupero password. Il primo amministratore deve usare un indirizzo di cui controlla la casella.

La versione web richiede Internet; non importa automaticamente i progetti locali dell'APK. Le annotazioni restano separate dal PDF originale. L'autore indica l'account e il nome dichiarato alla registrazione, non una firma digitale. Una revoca blocca le letture successive, ma non può ritirare copie di file già scaricate. Il piano Free non include backup automatici: predisporre copie periodiche di database e file prima dell'uso operativo.

I file PDF non vengono inviati a servizi AI. PDF.js è incluso localmente nella build (licenza Apache-2.0).
