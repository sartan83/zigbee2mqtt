# Configuratore Gewiss

Servizio autonomo per il **dimensionamento del magnetotermico**, il **preventivo** e la **lista materiali** di un impianto elettrico monofase con serie civili Gewiss.
È indipendente da Zigbee2MQTT: ha un proprio `package.json`, proprie dipendenze e propri test, e non modifica alcun file del progetto principale.

```
gewiss-configurator/
├── api/                         API REST (Node.js + Express 5, ES modules)
│   ├── server.js                entry point (porta, segnali di arresto)
│   ├── app.js                   costruzione app Express: helmet, CORS, rate limit, JSON, route, errori
│   ├── routes/calcolo.js        GET /api/health, GET /api/listino, POST /api/calcolo
│   ├── services/calcolatore.js  motore di calcolo PURO (nessuna dipendenza HTTP)
│   ├── data/listino.js          listino prezzi e regole tecniche (solo dati)
│   ├── middleware/
│   │   ├── validazione.js       validazione rigorosa dell'input (400 descrittivo)
│   │   └── errori.js            404 e gestione errori centralizzata
│   └── test/                    Vitest + supertest
│       ├── calcolatore.test.js  unit test del motore
│       ├── api.test.js          integration test degli endpoint
│       ├── golden.test.js       non regressione su golden/casi.json
│       ├── demo-parita.test.js  parità modalità demo SPA ↔ motore API
│       └── golden/casi.json     casi di riferimento input → output atteso
└── webapp/                      SPA vanilla JS, nessuna build
    ├── index.html
    ├── style.css
    ├── app.js                   form, debounce, fetch + AbortController, rendering
    └── demo.js                  motore di calcolo locale per la modalità demo
```

## Ricerca del configuratore legacy

Prima dell'implementazione è stato cercato nel repository (sorgenti, documentazione e cronologia git) codice del vecchio configuratore con i termini
`gewiss`, `configuratore`, `preventivo`, `interruttori`, `quadro elettrico`, `magnetotermico`: **non è stato trovato nulla**.
Il servizio usa quindi il motore di calcolo di default descritto sotto, con formule e prezzi isolati per poter essere sostituiti con quelli legacy.

## Avvio

Requisiti: Node.js ≥ 20 con npm, Python 3 (solo per servire la SPA).

```bash
# API (http://localhost:3000)
cd gewiss-configurator/api
npm install && npm start

# SPA (http://localhost:8080), in un secondo terminale
cd gewiss-configurator/webapp
python -m http.server 8080
```

Test:

```bash
cd gewiss-configurator/api
npm test
```

## API

### `POST /api/calcolo`

```bash
curl -s http://localhost:3000/api/calcolo -H 'Content-Type: application/json' -d '{
  "numero_interruttori_gewiss": 10,
  "potenza_totale_kw": 4.5,
  "numero_punti_luce": 12,
  "superficie_mq": 85,
  "tipo_impianto": "residenziale"
}'
```

| Campo | Tipo | Vincoli |
|---|---|---|
| `numero_interruttori_gewiss` | numero intero | 0 – 1000 |
| `potenza_totale_kw` | numero | 0 – 1000 (in pratica ≤ 14,49 kW: oltre si superano i 63 A) |
| `numero_punti_luce` | numero intero | 0 – 5000 |
| `superficie_mq` | numero | 0 – 100000 |
| `tipo_impianto` | stringa | `residenziale` \| `commerciale` |

Risposta `200`:

```json
{
  "tipo_impianto": "residenziale",
  "listino_versione": "2026.1-default",
  "corrente_totale_a": 19.57,
  "corrente_contemporanea_a": 15.65,
  "fattore_contemporaneita": 0.8,
  "magnetotermico_a": 20,
  "costo_materiali": 125,
  "costo_manodopera": 570,
  "imponibile": 695,
  "aliquota_iva": 22,
  "iva": 152.9,
  "totale": 847.9,
  "materiali": [
    {"codice": "GW-CHORUS-INT-1P16", "descrizione": "Interruttore Gewiss serie Chorus 1P 16 AX", "serie": "Chorus",
     "quantita": 10, "unita": "pz", "prezzo_unitario": 12.5, "importo": 125, "compreso_in": null},
    {"codice": "GW-MTC-1PN-C20", "descrizione": "Magnetotermico Gewiss MTC 1P+N curva C 4,5 kA 20 A",
     "quantita": 1, "unita": "pz", "prezzo_unitario": 0, "importo": 0, "compreso_in": "quota_fissa"},
    {"codice": "GW-CAVO-FS17-25", "descrizione": "Cavo unipolare FS17 450/750 V 2,5 mm²",
     "quantita": 552, "unita": "m", "prezzo_unitario": 0, "importo": 0, "compreso_in": "costo_punto_luce"},
    {"codice": "GW-DLP-CAN-40X17", "descrizione": "Canalina Gewiss DLP 40×17 mm",
     "quantita": 68, "unita": "m", "prezzo_unitario": 0, "importo": 0, "compreso_in": "costo_punto_luce"}
  ]
}
```

Errori (sempre `{errore, codice, messaggio, dettagli?}`):

| Stato | `codice` | Quando |
|---|---|---|
| 400 | `INPUT_NON_VALIDO` | campi mancanti, negativi, non numerici (anche `"4.5"` come stringa), non interi, fuori limite, sconosciuti, `tipo_impianto` non previsto. `dettagli` elenca gli errori per campo |
| 400 | `JSON_NON_VALIDO` | corpo non è JSON valido |
| 413 | `CORPO_TROPPO_GRANDE` | corpo oltre 10 kB |
| 422 | `FUORI_TAGLIA` | corrente oltre la taglia massima monofase (63 A) |
| 404 | `NON_TROVATO` | route inesistente |
| 429 | `TROPPE_RICHIESTE` | rate limit superato |
| 500 | `ERRORE_INTERNO` | errore imprevisto (dettagli solo nei log) |

### `GET /api/health`

`{"stato": "ok", "servizio": "gewiss-configurator-api", "listino_versione": "...", "timestamp": "..."}`

### `GET /api/listino`

Restituisce l'intero listino attivo (`data/listino.js`): regole elettriche, IVA, prezzi per tipologia, articoli, limiti di input.

## Motore di calcolo (default)

Implementato in `api/services/calcolatore.js`, una funzione esportata per ogni passo:

1. **Corrente totale installata** (monofase): `I = potenza_kw × 1000 / 230`.
2. **Corrente contemporanea**: `I_c = I × 0,8` (fattore di contemporaneità Kc).
3. **Magnetotermico**: la più piccola taglia standard `≥` della corrente di dimensionamento, tra 6/10/16/20/25/32/40/63 A.
   Una corrente esattamente pari a una taglia seleziona quella taglia (16,00 A → 16 A). Oltre 63 A → errore `FUORI_TAGLIA` (serve un impianto trifase).
   La corrente di dimensionamento è scelta da `regole_elettriche.base_dimensionamento`:
   - `"installata"` (default): taglia sulla corrente installata, così 4,5 kW → 19,57 A → **20 A**;
   - `"contemporanea"`: taglia sulla corrente × Kc, così 4,5 kW → 15,65 A → 16 A.
4. **Preventivo** (importi in centesimi interi, arrotondamento half-up):
   - `costo_materiali = numero_interruttori × prezzo_interruttore`
   - `costo_manodopera = numero_punti_luce × costo_punto_luce + quota_fissa`
   - `iva = (costo_materiali + costo_manodopera) × 22%`, arrotondata al centesimo
   - `totale = costo_materiali + costo_manodopera + iva`
5. **Lista materiali**:
   - interruttori della serie Gewiss della tipologia (Chorus per residenziale, System per commerciale), a prezzo;
   - magnetotermico generale della taglia calcolata, compreso nella quota fissa;
   - cavo FS17: `(punti_luce × m/punto + interruttori × m/interruttore) × 3 conduttori` (F+N+PE), metri arrotondati per eccesso, sezione in base alla taglia;
   - canalina DLP: `superficie_mq × m/m²`, arrotondata per eccesso.

   Cavi e canaline sono compresi nel costo del punto luce (`compreso_in`), per cui compaiono solo come quantità.

> Codici articolo (`GW-…`) e prezzi del listino di default sono **segnaposto**: sostituirli con quelli del catalogo/listino in uso.

## Configurazione

### API

| Variabile | Default | Descrizione |
|---|---|---|
| `PORT` | `3000` | porta HTTP |
| `HOST` | `0.0.0.0` | interfaccia di ascolto |
| `CORS_ORIGIN` | `*` | origini ammesse, separate da virgola (es. `http://localhost:8080,https://configuratore.example.it`) |
| `RATE_LIMIT_MAX` | `120` | richieste per finestra e per IP su `/api/*` |
| `RATE_LIMIT_WINDOW_MS` | `60000` | durata della finestra di rate limiting |
| `TRUST_PROXY` | `false` | `true` se dietro reverse proxy (IP client da `X-Forwarded-For`) |

```bash
CORS_ORIGIN=http://localhost:8080 PORT=3000 npm start
```

### SPA: `API_BASE_URL`

`API_BASE_URL` è definito in cima a `webapp/app.js` (default `http://localhost:3000`). Si può sovrascrivere senza toccare il file:

- parametro URL: `http://localhost:8080/?api=http://192.168.1.10:3000`;
- variabile globale prima dello script in `index.html`: `<script>window.GEWISS_API_BASE_URL = "https://api.example.it";</script>`.

Se l'API non è raggiungibile e la casella "modalità demo" è attiva, la SPA calcola localmente con `webapp/demo.js` (listino di default) e lo segnala con un avviso.

## Aggiornare il listino

Tutti i prezzi e le regole sono **dati** in `api/data/listino.js`; il motore non contiene costanti numeriche.

1. Modificare i valori (prezzi IVA esclusa in euro, taglie, sezioni cavo, coefficienti metri/punto, metri/m², IVA, limiti di input).
2. Incrementare `VERSIONE_LISTINO`: viene restituita da `/api/health`, `/api/listino` e in ogni calcolo.
3. Aggiornare i valori attesi in `api/test/golden/casi.json` per i casi con `"origine": "default"`.
4. Riportare le stesse modifiche in `webapp/demo.js` (`LISTINO_DEMO`): `test/demo-parita.test.js` fallisce se demo e API divergono.
5. `npm test`.

Per una formula diversa (es. trifase, IVA agevolata al 10%, prezzi per scaglioni), modificare la sola funzione interessata in `services/calcolatore.js`
e aggiungere il relativo parametro in `data/listino.js`.

## Golden test e dati legacy

`api/test/golden/casi.json` contiene i casi di riferimento verificati da `test/golden.test.js`:

```json
{
    "tolleranza_importi": 0.005,
    "tolleranza_correnti": 0.005,
    "casi": [
        {
            "id": "legacy-001",
            "descrizione": "Preventivo cliente Rossi, villetta 120 m²",
            "origine": "legacy",
            "input": {"numero_interruttori_gewiss": 14, "potenza_totale_kw": 6, "numero_punti_luce": 22, "superficie_mq": 120, "tipo_impianto": "residenziale"},
            "atteso": {"corrente_totale_a": 26.09, "magnetotermico_a": 32, "costo_materiali": 175, "costo_manodopera": 920, "iva": 240.9, "totale": 1335.9}
        },
        {
            "id": "legacy-002",
            "descrizione": "Caso non calcolabile dal legacy",
            "origine": "legacy",
            "input": {"numero_interruttori_gewiss": 20, "potenza_totale_kw": 15, "numero_punti_luce": 30, "superficie_mq": 200, "tipo_impianto": "residenziale"},
            "atteso_errore": {"codice": "FUORI_TAGLIA"}
        }
    ]
}
```

- `atteso` può contenere solo i campi di cui si conosce il valore legacy; quelli assenti non sono verificati.
- `atteso.materiali` (opzionale) è confrontato su `codice` e `quantita`, nell'ordine.
- Gli importi sono confrontati con tolleranza `tolleranza_importi` (mezzo centesimo), le correnti con `tolleranza_correnti`.

Procedura consigliata per la migrazione dal configuratore legacy:

1. Esportare dal software legacy un campione rappresentativo di preventivi (input + output), inclusi casi limite: valori a zero, correnti pari a una taglia, potenze alte, importi con arrotondamento IVA.
2. Aggiungerli a `casi.json` con `"origine": "legacy"` e `id` univoci.
3. Eseguire `npm test`: ogni caso che fallisce indica una differenza di formula o di prezzo, con campo, valore atteso e ottenuto.
4. Allineare `data/listino.js` (prezzi) o `services/calcolatore.js` (formule) fino a suite verde, poi rimuovere o rigenerare i casi `"default"` non più validi.
