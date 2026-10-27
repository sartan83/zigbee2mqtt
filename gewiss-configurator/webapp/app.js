/**
 * SPA del configuratore Gewiss (vanilla JS, nessuna build).
 *
 * Configurazione: API_BASE_URL indica l'origine dell'API REST. Si può
 * sovrascrivere senza modificare questo file definendo window.GEWISS_API_BASE_URL
 * prima del caricamento dello script, oppure con il parametro ?api=http://host:porta.
 */

import {calcolaDemo} from "./demo.js";

const API_BASE_URL = new URLSearchParams(window.location.search).get("api") ?? window.GEWISS_API_BASE_URL ?? "http://localhost:3000";

/** Attesa dopo l'ultima digitazione prima di inviare la richiesta di calcolo [ms]. */
const DEBOUNCE_MS = 300;
/** Timeout della richiesta HTTP [ms]. */
const TIMEOUT_MS = 8000;

const CAMPI_NUMERICI = ["numero_interruttori_gewiss", "potenza_totale_kw", "numero_punti_luce", "superficie_mq"];

const formatoEuro = new Intl.NumberFormat("it-IT", {style: "currency", currency: "EUR"});
const formatoNumero = new Intl.NumberFormat("it-IT", {maximumFractionDigits: 2});
const formatoCorrente = new Intl.NumberFormat("it-IT", {minimumFractionDigits: 2, maximumFractionDigits: 2});

const COMPRESO_IN = {quota_fissa: "compreso nella quota fissa", costo_punto_luce: "compreso nel punto luce"};

const el = (id) => document.getElementById(id);
const form = el("form-calcolo");

let controllerCorrente = null;
let timerDebounce = null;
let apiRaggiungibile = null;

/** Errore restituito dall'API con corpo JSON { errore, codice, messaggio, dettagli? }. */
class ErroreApi extends Error {
    constructor(stato, corpo) {
        super(corpo?.messaggio || corpo?.errore || `Errore HTTP ${stato}`);
        this.stato = stato;
        this.dettagli = corpo?.dettagli ?? [];
    }
}

function leggiForm() {
    const dati = {tipo_impianto: form.tipo_impianto.value};
    for (const campo of CAMPI_NUMERICI) {
        const grezzo = form[campo].value.trim();
        // Campo vuoto (o non numerico per il browser) → assente: sarà l'API a segnalarlo.
        dati[campo] = grezzo === "" ? null : Number(grezzo);
    }
    return dati;
}

function impostaStatoApi(stato, testo) {
    const badge = el("stato-api");
    badge.dataset.stato = stato;
    badge.textContent = testo;
}

function impostaCaricamento(attivo) {
    el("caricamento").hidden = !attivo;
    el("titolo-risultati").closest("section").setAttribute("aria-busy", String(attivo));
}

function mostraErrore(messaggio, dettagli = []) {
    const box = el("errore");
    box.textContent = messaggio;
    box.hidden = !messaggio;

    const campiErrati = new Set(dettagli.map((d) => d.campo));
    for (const campo of [...CAMPI_NUMERICI, "tipo_impianto"]) {
        form[campo].setAttribute("aria-invalid", String(campiErrati.has(campo)));
        if (campiErrati.has(campo)) {
            form[campo].setAttribute("aria-describedby", "errore");
        } else {
            form[campo].removeAttribute("aria-describedby");
        }
    }
}

function svuotaRisultati() {
    for (const id of ["r-corrente", "r-magnetotermico", "r-materiali", "r-manodopera", "r-iva", "r-totale"]) {
        el(id).textContent = "—";
    }
    el("r-corrente-contemporanea").textContent = "";
    el("r-imponibile").textContent = "";
    el("r-tabella").innerHTML = '<tr><td colspan="5" class="vuoto">Nessun calcolo disponibile.</td></tr>';
}

function cella(testo, classe) {
    const td = document.createElement("td");
    td.textContent = testo;
    if (classe) {
        td.className = classe;
    }
    return td;
}

function mostraRisultato(r) {
    el("r-corrente").textContent = `${formatoCorrente.format(r.corrente_totale_a)} A`;
    el("r-corrente-contemporanea").textContent =
        `Contemporanea (Kc ${formatoNumero.format(r.fattore_contemporaneita)}): ${formatoCorrente.format(r.corrente_contemporanea_a)} A`;
    el("r-magnetotermico").textContent = `${r.magnetotermico_a} A`;
    el("r-materiali").textContent = formatoEuro.format(r.costo_materiali);
    el("r-manodopera").textContent = formatoEuro.format(r.costo_manodopera);
    el("t-iva").textContent = `IVA ${r.aliquota_iva}%`;
    el("r-iva").textContent = formatoEuro.format(r.iva);
    el("r-imponibile").textContent = `Imponibile ${formatoEuro.format(r.imponibile)}`;
    el("r-totale").textContent = formatoEuro.format(r.totale);
    el("r-listino").textContent = `Listino ${r.listino_versione}`;

    const corpo = el("r-tabella");
    corpo.replaceChildren(
        ...r.materiali.map((m) => {
            const riga = document.createElement("tr");
            const compreso = m.compreso_in ? COMPRESO_IN[m.compreso_in] || "compreso" : null;
            riga.append(
                cella(m.codice, "codice"),
                cella(m.descrizione),
                cella(`${formatoNumero.format(m.quantita)} ${m.unita}`, "num"),
                cella(compreso ? "—" : formatoEuro.format(m.prezzo_unitario), "num"),
                cella(compreso ?? formatoEuro.format(m.importo), compreso ? "num compreso" : "num"),
            );
            return riga;
        }),
    );
}

async function richiediCalcolo(dati, segnale) {
    const risposta = await fetch(`${API_BASE_URL}/api/calcolo`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(dati),
        signal: segnale,
    });
    const corpo = await risposta.json().catch(() => null);
    if (!risposta.ok) {
        throw new ErroreApi(risposta.status, corpo);
    }
    return corpo;
}

/** Validazione minima lato client, usata solo in modalità demo (in linea con l'API). */
function validaDemo(dati) {
    const dettagli = [];
    for (const campo of CAMPI_NUMERICI) {
        const v = dati[campo];
        const etichetta = form.querySelector(`label[for="${campo}"]`).textContent.trim();
        if (v === null || !Number.isFinite(v)) {
            dettagli.push({campo, messaggio: `${etichetta}: inserire un numero.`});
        } else if (v < 0) {
            dettagli.push({campo, messaggio: `${etichetta}: non può essere negativo.`});
        } else if ((campo === "numero_interruttori_gewiss" || campo === "numero_punti_luce") && !Number.isInteger(v)) {
            dettagli.push({campo, messaggio: `${etichetta}: deve essere un numero intero.`});
        }
    }
    return dettagli;
}

function calcolaInDemo(dati) {
    el("avviso-demo").hidden = false;
    impostaStatoApi("demo", "Modalità demo");
    const dettagli = validaDemo(dati);
    if (dettagli.length > 0) {
        svuotaRisultati();
        mostraErrore(dettagli.map((d) => d.messaggio).join(" "), dettagli);
        return;
    }
    try {
        mostraRisultato(calcolaDemo(dati));
        mostraErrore("");
    } catch (errore) {
        svuotaRisultati();
        mostraErrore(errore.message);
    }
}

async function aggiorna() {
    // Annulla la richiesta precedente ancora in corso: vale solo l'ultimo input.
    controllerCorrente?.abort();
    const controller = new AbortController();
    controllerCorrente = controller;
    const timeout = setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), TIMEOUT_MS);

    const dati = leggiForm();
    impostaCaricamento(true);

    try {
        const risultato = await richiediCalcolo(dati, controller.signal);
        apiRaggiungibile = true;
        impostaStatoApi("online", "API online");
        el("avviso-demo").hidden = true;
        mostraRisultato(risultato);
        mostraErrore("");
    } catch (errore) {
        if (controller !== controllerCorrente) {
            return; // Sostituita da una richiesta più recente.
        }
        if (errore instanceof ErroreApi) {
            apiRaggiungibile = true;
            impostaStatoApi("online", "API online");
            el("avviso-demo").hidden = true;
            svuotaRisultati();
            mostraErrore(errore.message, errore.dettagli);
        } else if (form.modalita_demo.checked) {
            apiRaggiungibile = false;
            calcolaInDemo(dati);
        } else {
            apiRaggiungibile = false;
            impostaStatoApi("offline", "API non raggiungibile");
            el("avviso-demo").hidden = true;
            svuotaRisultati();
            mostraErrore(`Impossibile contattare l'API su ${API_BASE_URL}. Verificare che il servizio sia avviato o attivare la modalità demo.`);
        }
    } finally {
        clearTimeout(timeout);
        if (controller === controllerCorrente) {
            impostaCaricamento(false);
        }
    }
}

function pianificaAggiornamento() {
    clearTimeout(timerDebounce);
    timerDebounce = setTimeout(aggiorna, DEBOUNCE_MS);
}

async function verificaApi() {
    try {
        const risposta = await fetch(`${API_BASE_URL}/api/health`, {signal: AbortSignal.timeout(TIMEOUT_MS)});
        if (risposta.ok && apiRaggiungibile === null) {
            impostaStatoApi("online", "API online");
        }
    } catch {
        if (apiRaggiungibile === null) {
            impostaStatoApi("offline", "API non raggiungibile");
        }
    }
}

form.addEventListener("input", pianificaAggiornamento);
form.addEventListener("change", pianificaAggiornamento);
form.addEventListener("submit", (evento) => {
    evento.preventDefault();
    clearTimeout(timerDebounce);
    void aggiorna();
});

void verificaApi();
void aggiorna();
