# Sharework

Web app per progetti PDF condivisi, con registrazione, accesso e approvazione del super admin. Admin e Super admin vedono tutti i progetti. Entrambi possono modificare le annotazioni. Gli altri account vedono i progetti assegnati, con livello di sola lettura o modifica delle annotazioni per ciascun progetto. Nessun documento è accessibile senza autenticazione e approvazione.

## Funzioni

- Ogni progetto apre direttamente la General Overview del proprio Piano nave.
- Caricamento del Piano nave da parte del Super admin, fino a 50 MB, in Supabase Storage privato.
- Note numerate per progetto, forme e icone (fiamma, attenzione, elettrico, attrezzatura), tavolozza colori.
- Evidenziatore libero con spessore in coordinate PDF e trasparenza.
- Titolo e descrizione salvati automaticamente, nome autore e data assegnati dal database.
- Zoom con rendering della zona visibile, pannelli riducibili e ridimensionabili.
- Ricerca nelle note e filtri per pagina o ponte, simbolo, autore e data.
- Annulla/Ripeti e controllo versione per rilevare modifiche concorrenti.
- Aggiornamenti tramite Supabase Realtime di progetti, documenti, annotazioni e approvazioni. Recupero periodico ogni 10 secondi in caso di eventi persi. Durante una finestra di modifica gli aggiornamenti vengono rimandati alla chiusura per proteggere il testo in lavorazione.
- PWA installabile da Edge/Chrome su PC, con finestra autonoma. Richiede Internet.
- Il Super admin approva gli account e assegna i ruoli amministrativi. Da Gestisci progetto, gli Admin assegnano sola lettura o modifica delle annotazioni per progetto.

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

1. Nel SQL Editor del progetto eseguire **una sola volta** `supabase/001_sharework.sql`, poi `supabase/003_project_documents.sql`. Le migrazioni sono transazionali e preservano gli eventuali documenti della prima versione. Se esistono già oggetti `sw_*`, controllare quali migrazioni risultano applicate prima di ripeterle.
2. In Authentication abilitare Email, registrazioni e conferma email. Lasciare disabilitato l'accesso anonimo.
3. Configurare un proprio SMTP per inviti, conferma email e recupero password. Il servizio di prova Supabase non è adatto agli utenti esterni al team del progetto.
4. In URL Configuration impostare il dominio definitivo come Site URL e aggiungerlo agli URL di redirect consentiti, includendo il percorso esatto dell'app.
5. Registrare il primo amministratore dall'app e confermare la sua email.
6. In `002_first_admin.sql` sostituire il segnaposto con l'email dell'amministratore e eseguirlo nel SQL Editor. Il controllo richiede email confermata. Non pubblicare una versione compilata con credenziali amministrative.
7. Eseguire `supabase/005_ship_plans_roles.sql` una volta. Gli amministratori già approvati diventano super admin. Per una nuova installazione completare il passaggio 6 prima di questa migrazione.
8. Eseguire `supabase/006_project_cards_ship_setup.sql`.
9. Eseguire `supabase/007_project_access.sql` poi `supabase/008_admin_annotation_access.sql` fino a `supabase/017_super_admin_projects.sql`. Le assegnazioni iniziano vuote.
10. Il super admin abilita i nuovi utenti e ne assegna il ruolo dalla pagina Utenti.

`src/config.js` contiene l'URL e la sola chiave pubblica/publishable, utilizzabile nel browser. Non inserire `service_role`, secret key o password nel repository. Tutte le autorizzazioni sono applicate anche nel database e nello Storage; il nome autore non dipende dal contenuto inviato dal browser.

## Piani nave

Da **Gestisci progetto**, il Super admin può caricare, sostituire e configurare il Piano nave. Nella schermata dedicata seleziona la pagina longitudinale e le pagine dei ponti. Per ogni tavola posiziona le due ordinate di riferimento e imposta la distanza. Sulla longitudinale indica anche le linee di base dei ponti. Le linee di calibrazione sono visibili nella configurazione.

Le schede dei progetti mostrano copertina, nome e periodo. Per i progetti esistenti, aprire **Modifica progetto** per impostare questi dati. Il selettore **Lingua** imposta italiano o inglese per l’interfaccia.

Nei Piani nave la General Overview è la vista iniziale. Le nuove annotazioni si inseriscono sulle pagine dei ponti. In Overview si possono aprire e modificare le annotazioni esistenti secondo i permessi dell'account. Le note sono proiettate appena sopra la linea di base. Da una nota, **Evidenzia area** aggiunge uno o più tratti sotto lo stesso numero. Ogni tratto viene riportato lungo il proprio intervallo di ordinate. Le evidenziazioni storiche restano consultabili. Se più elementi si sovrappongono, un tocco apre l’elenco degli elementi in quella zona.

## Pubblicazione GitHub Pages

Sito: https://davidegolisano-design.github.io/Sharework/

Eseguire `node scripts/prepare-pages.mjs`, poi includere `docs/` nel commit. Pages pubblica il ramo `main`, cartella `/docs`. La CSP è inclusa anche nel documento HTML, perché GitHub Pages non usa `_headers`. La PWA usa percorsi relativi e non contiene servizi ChatGPT. Codice e hosting sono su GitHub; autenticazione, dati e file su Supabase. Eseguire anche `supabase/004_realtime.sql` per attivare le notifiche, mantenendo le policy RLS esistenti.

Per installare: aprire il sito in Edge/Chrome e premere **Installa app**. Se il browser non mostra la richiesta, usare la funzione di installazione dal suo menu. Condividere il link, non il manifest da solo. La PWA memorizza soltanto una pagina generica di assenza connessione nella cache del service worker; non offre modifiche offline.

Il sito pubblico mostra solo l'accesso. I PDF non si trovano nel repository o nella cartella pubblicata: sono nel bucket privato `sharework-pdfs`. Dopo il login vengono scaricati con il token dell'utente, senza URL pubblici permanenti.

## Notifiche di registrazione

Per attivare gli avvisi, applicare `supabase/018_registration_alert.sql` e pubblicare la Edge Function `registration-alert`. Il trigger invia solo l’identificativo dell’account e usa un token generato in Vault. La funzione recupera nome ed email dal server e invia il messaggio a `sharework.reg@liveasta.it` via Aruba SMTP. Per abilitarla aggiungere in Vault il segreto `sw_registration_smtp_password` con la password del mittente Aruba. Se il mittente è diverso dalla destinazione, configurare prima anche `sw_registration_smtp_user` con il suo indirizzo completo. Il trigger parte dalle nuove registrazioni e lascia invariato il flusso di conferma email.

## App Android

L’APK v10 apre Sharework direttamente a schermo intero e segue la rotazione di sistema. Il pacchetto `it.sgdp.sharework` si può installare accanto al v9. Entrambi accedono allo stesso sito con le credenziali Sharework. Il v10 usa l’icona della PWA e il selettore file di Android per PDF ed Excel.

Per ricompilare, impostare `ANDROID_JAR` (API 34), `ANDROID_BUILD_TOOLS`, `SHAREWORK_KEYSTORE` e `SHAREWORK_STORE_PASSWORD`, quindi eseguire `android/build.sh`. Per gli aggiornamenti di questo pacchetto usare lo stesso certificato di firma.

## Verifiche e limiti

`pnpm test` esegue veri test SQL su PostgreSQL locale tramite PGlite, con ruoli e Row Level Security: accesso negato ai non approvati, impossibilità di auto-approvazione, identità autore non falsificabile, numerazione, controllo versione e file privati. PGlite simula le tabelle Auth/Storage necessarie; non sostituisce il collaudo dei servizi Auth/Storage sul progetto Supabase reale.

Prima di pubblicare questa release web, applicare le migrazioni fino a `017_super_admin_projects.sql`. Ogni progetto può avere un Piano nave. Prima dell'uso operativo collaudare con due account: registrazione/conferma, approvazione, importazione PDF, modifiche concorrenti, revoca accesso e recupero password. Il primo amministratore deve usare un indirizzo di cui controlla la casella.

La versione web richiede Internet; non importa automaticamente i progetti locali dell'APK. Le annotazioni restano separate dal PDF originale. L'autore indica l'account e il nome dichiarato alla registrazione, non una firma digitale. Una revoca blocca le letture successive, ma non può ritirare copie di file già scaricate. Il piano Free non include backup automatici: predisporre copie periodiche di database e file prima dell'uso operativo.

I file PDF non vengono inviati a servizi AI. PDF.js è incluso localmente nella build (licenza Apache-2.0).

Gli account si eliminano da **Authentication → Users**. Il profilo e le assegnazioni vengono rimossi. Progetti, documenti, annotazioni e attribuzione storica restano disponibili. Per gli account proprietari di file in Storage, consultare le istruzioni di Supabase per riassegnare la proprietà prima dell’eliminazione.
