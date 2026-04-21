# ArkManiaGest — Guida all'installazione (italiano)

Questa guida ti accompagna nell'installazione del pannello di gestione
ArkManiaGest a partire dal bundle di release scaricato da GitHub.
Seguila se vuoi fare il deploy del pannello sul tuo VPS Linux.

> **Licenza**: ArkManiaGest è un software **source-available, non open
> source**.  Il codice è pubblico per trasparenza e valutazione, ma
> qualsiasi deploy — commerciale o meno — richiede
> **autorizzazione scritta preventiva** di Lomatek / ArkMania.it.
> Scrivi a `info@arkmania.it` per richiederla.
> Vedi [LICENSE](../LICENSE).

---

## Architettura in breve

```
┌──────────────────────────────┐        SSH (porta 22)       ┌────────────────┐
│  Il tuo PC (Windows o Linux) │ ──────────────────────────► │ VPS Linux       │
│  — scarichi la release       │   install-panel.ps1/.sh     │ (host pannello) │
│  — lanci install-panel.*     │                             │ solo OpenSSH    │
└──────────────────────────────┘                             └────────────────┘
                                                                    │
                                                                    │ SSH
                                                                    ▼
                                                        ┌────────────────────────┐
                                                        │ Macchine di gioco (N)  │
                                                        │ Linux o Windows+WSL    │
                                                        │ con container Docker   │
                                                        │ POK-manager per        │
                                                        │ ARK: Survival Ascended │
                                                        └────────────────────────┘
```

- Il **client** (il PC dal quale lanci l'installer) può essere
  Windows o Linux — gli serve solo `ssh`, `scp`, `tar` (standard su
  Windows 10/11 e su qualunque Linux moderno).
- L'**host del pannello** è un VPS Linux (Debian 11+ / Ubuntu 22.04+)
  con solo OpenSSH già installato.  L'installer si occupa di tutto il
  resto: Python, Node, MariaDB (opzionale), Nginx, Let's Encrypt, UFW,
  Fail2ban, systemd.
- Le **macchine di gioco** si aggiungono successivamente dalla UI del
  pannello: possono essere un mix libero di Linux nativo e Windows
  con WSL2 + Ubuntu.

---

## Prerequisiti

### Sul tuo PC (il client)

| Piattaforma | Requisiti |
|-------------|-----------|
| Windows 10/11 | PowerShell 5.1+ (incluso), OpenSSH client (incluso da Win10 1809) |
| Linux | `bash`, `ssh`, `scp`, `tar`, `curl`, `openssl`, `base64` (standard) |

Nient'altro.  Nessun Python / Node / Docker sul client.

### Sul server di destinazione (il VPS)

- Debian 11+ o Ubuntu 22.04+ (altre distribuzioni possono funzionare
  ma non sono testate dall'installer).
- Un utente SSH **con sudo** (tipicamente `root` o un utente del
  gruppo `sudo`/`wheel`).
- **DNS**: il dominio pubblico che vuoi usare (es.
  `pannello.esempio.it`) deve già puntare all'IP pubblico del server.
  Let's Encrypt verifica il possesso via HTTP sulla porta 80 durante
  l'installazione.
- Porte **in ingresso** aperte: 22 (SSH), 80 (HTTP → redirect HTTPS),
  443 (HTTPS).
- Accesso Internet (servirà ad `apt` + certbot + strumenti Steam
  quando aggiungerai le macchine di gioco).

### Se vuoi usare una macchina Windows come host del pannello

L'installer pannello supporta solo target Linux.  Se il tuo VPS è
Windows, installa **WSL2** con una distro Ubuntu e punta l'installer
all'endpoint WSL.  Vedi la sezione "Panel on a Windows server" nel
[README.md](../README.md) principale.

---

## Passo 1 — Scarica la release

1. Vai su
   [https://github.com/Mrtritolo/ArkManiaGest/releases/latest](https://github.com/Mrtritolo/ArkManiaGest/releases/latest)
2. Scarica l'archivio che corrisponde al tuo **client**:
   - **Client Windows** → `arkmaniagest-vX.Y.Z-windows.zip`
   - **Client Linux** → `arkmaniagest-vX.Y.Z-linux.tar.gz`
3. Verifica il checksum con `SHA256SUMS.txt` (opzionale ma
   raccomandato).

## Passo 2 — Estrai

### Windows

```powershell
Expand-Archive arkmaniagest-vX.Y.Z-windows.zip -DestinationPath .
cd arkmaniagest-vX.Y.Z
```

### Linux

```bash
tar -xzf arkmaniagest-vX.Y.Z-linux.tar.gz
cd arkmaniagest-vX.Y.Z
```

## Passo 3 — Lancia l'installer

### Da client Windows

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\install-panel.ps1
```

### Da client Linux

```bash
bash ./deploy/install-panel.sh
```

### Cosa ti chiede l'installer

Lo script è interattivo.  Richiede:

1. **Indirizzo del server** (IP o hostname).
2. **Utente SSH** + **porta SSH** (default `22`).
3. **Autenticazione SSH**: l'installer prova prima a usare
   `ssh-agent` o le chiavi di default.  Se funziona già, non chiede
   altro.  Altrimenti ti chiede se vuoi usare un file di chiave
   (chiedendone il percorso) oppure una password.
4. **Dominio pubblico** per il pannello (es. `pannello.esempio.it`).
5. **Email admin** per le notifiche Let's Encrypt.
6. **MariaDB**:
   - "Installare MariaDB sul target?" — rispondi **sì** per avere
     un'installazione autonoma.  Rispondi **no** se hai già un
     MariaDB che vuoi riusare.
   - Nome database, user, password.  Lascia la password vuota per
     generarne una casuale (viene salvata nel `.env` del server).
7. **User / nome visualizzato / password** dell'amministratore del
   pannello web.

Dopo la conferma, l'installer:

- Verifica connettività SSH e sudo.
- Genera localmente `deploy.conf` + `backend/.env` (con
  `JWT_SECRET`, `FIELD_ENCRYPTION_KEY` random).
- `scp` del tarball su `/tmp/` del server.
- Esegue `deploy/full-deploy.sh` sul server (apt, venv Python, build
  Node, Nginx, Let's Encrypt, UFW, Fail2ban, systemd).
- Crea l'utente admin iniziale chiamando l'endpoint `/settings/setup`.

Il processo completo dura 5–10 minuti circa.

## Passo 4 — Verifica post-installazione

```bash
# Servizio attivo
sudo systemctl status arkmaniagest

# Endpoint health raggiungibile
curl -sf https://<dominio>/health

# Controllo DB
sudo -u arkmania /opt/arkmaniagest/backend/venv/bin/python \
    /opt/arkmaniagest/deploy/test_db.py
```

Apri `https://<dominio>` nel browser e fai login con le credenziali
admin che hai scelto durante l'installazione.

## Passo 5 — Aggiungi le macchine di gioco

Nel pannello, **Macchine → Nuova macchina SSH**:

1. Seleziona il sistema operativo host (Linux / Windows + WSL) — il
   badge nella card rispecchia la scelta.
2. Inserisci host SSH, porta, utente, chiave o password.
3. Clicca **Test connessione**.
4. Il pannello salva le credenziali cifrate (AES-256-GCM) nel suo
   database.

La UI di orchestrazione Docker / POK-manager arriva nella prossima
release (v2.4).  Oggi puoi già scansionare container esistenti,
ispezionare il filesystem, editare `Game.ini` / `GameUserSettings.ini`,
e gestire i giocatori via RCON una volta che l'endpoint di bootstrap
sarà pronto.

---

## Aggiornamento a una release più recente

Rilancia lo stesso installer — è idempotente.  `backend/.env` viene
preservato e `deploy/migrate-env.sh` aggiunge le nuove chiavi
introdotte dalla release più recente.

Alternativa (incrementale, senza reinstallare i pacchetti):

```powershell
.\deploy\update-remote.ps1                 # sync completo
.\deploy\update-remote.ps1 -BackendOnly
.\deploy\update-remote.ps1 -FrontendOnly
```

Dal pannello stesso puoi controllare la versione in esecuzione e se è
disponibile una release più recente: **Impostazioni → Generali →
Aggiornamenti → Verifica ora**.

---

## Risoluzione problemi

| Sintomo | Soluzione |
|---------|-----------|
| `SSH test failed` | Prova prima `ssh utente@host` manualmente; fixa i permessi della chiave (`chmod 600`) o la password e rilancia. |
| `Let's Encrypt failed` | Controlla che il DNS punti davvero al server e che la porta 80 sia raggiungibile dall'esterno. |
| `MariaDB access denied` | Se hai risposto "no" a "installare MariaDB", assicurati che il DB indicato esista e che l'utente abbia tutti i privilegi sullo schema del pannello. |
| Pannello 502 Bad Gateway | `sudo systemctl status arkmaniagest` + `journalctl -u arkmaniagest -n 50` per capire l'errore reale. |
| `update-remote.ps1` chiede password ogni volta | Configura una chiave SSH sul target: `ssh-copy-id utente@host`. |

Per problemi di sicurezza, segui [SECURITY.md](../SECURITY.md) — **non**
aprire una issue pubblica per una vulnerabilità.

---

## Disinstallazione

```bash
sudo systemctl disable --now arkmaniagest
sudo rm -rf /opt/arkmaniagest /var/log/arkmaniagest /etc/systemd/system/arkmaniagest.service
sudo rm -f /etc/nginx/sites-enabled/arkmaniagest /etc/nginx/sites-available/arkmaniagest
sudo systemctl reload nginx
# Opzionale: elimina il database MariaDB e il suo utente
```
