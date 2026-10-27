/**
 * Validazione rigorosa del corpo di POST /api/calcolo (schema manuale, senza dipendenze).
 *
 * Regole:
 *  - il corpo deve essere un oggetto JSON;
 *  - tutti i campi sono obbligatori e non sono ammessi campi sconosciuti;
 *  - i campi numerici devono essere numeri JSON finiti (le stringhe come "5" sono rifiutate),
 *    non negativi, entro i limiti di data/listino.js e interi dove richiesto;
 *  - tipo_impianto deve essere una delle tipologie previste dal listino.
 *
 * In caso di errore risponde 400 con un messaggio descrittivo e il dettaglio per campo.
 */

import {LIMITI_INPUT, LISTINO_PER_TIPO} from "../data/listino.js";

const ETICHETTE_CAMPI = Object.freeze({
    numero_interruttori_gewiss: "Numero interruttori Gewiss",
    potenza_totale_kw: "Potenza totale (kW)",
    numero_punti_luce: "Numero punti luce",
    superficie_mq: "Superficie (m²)",
    tipo_impianto: "Tipo impianto",
});

export const CAMPI_CALCOLO = Object.freeze(Object.keys(ETICHETTE_CAMPI));

/**
 * Valida il corpo della richiesta di calcolo.
 * @param {unknown} corpo corpo JSON già decodificato
 * @returns {{campo: string, messaggio: string}[]} elenco degli errori (vuoto se valido)
 */
export function validaInputCalcolo(corpo) {
    if (corpo === null || typeof corpo !== "object" || Array.isArray(corpo)) {
        return [{campo: "(corpo)", messaggio: "Il corpo della richiesta deve essere un oggetto JSON."}];
    }

    const errori = [];

    for (const campo of Object.keys(corpo)) {
        if (!CAMPI_CALCOLO.includes(campo)) {
            errori.push({campo, messaggio: `Campo non previsto: "${campo}".`});
        }
    }

    for (const [campo, limiti] of Object.entries(LIMITI_INPUT)) {
        const etichetta = ETICHETTE_CAMPI[campo];
        const valore = corpo[campo];

        if (valore === undefined || valore === null || valore === "") {
            errori.push({campo, messaggio: `${etichetta}: campo obbligatorio.`});
        } else if (typeof valore !== "number" || !Number.isFinite(valore)) {
            errori.push({campo, messaggio: `${etichetta}: deve essere un numero.`});
        } else if (valore < 0) {
            errori.push({campo, messaggio: `${etichetta}: non può essere negativo.`});
        } else if (limiti.intero && !Number.isInteger(valore)) {
            errori.push({campo, messaggio: `${etichetta}: deve essere un numero intero.`});
        } else if (valore < limiti.min || valore > limiti.max) {
            errori.push({campo, messaggio: `${etichetta}: deve essere compreso tra ${limiti.min} e ${limiti.max}.`});
        }
    }

    const tipi = Object.keys(LISTINO_PER_TIPO);
    if (corpo.tipo_impianto === undefined || corpo.tipo_impianto === null || corpo.tipo_impianto === "") {
        errori.push({campo: "tipo_impianto", messaggio: `${ETICHETTE_CAMPI.tipo_impianto}: campo obbligatorio.`});
    } else if (typeof corpo.tipo_impianto !== "string" || !tipi.includes(corpo.tipo_impianto)) {
        errori.push({campo: "tipo_impianto", messaggio: `${ETICHETTE_CAMPI.tipo_impianto}: valori ammessi ${tipi.join(", ")}.`});
    }

    return errori;
}

/** Middleware Express: blocca con 400 le richieste di calcolo non valide. */
export function validaCalcolo(req, res, next) {
    const errori = validaInputCalcolo(req.body);
    if (errori.length > 0) {
        res.status(400).json({
            errore: "Dati di input non validi",
            codice: "INPUT_NON_VALIDO",
            messaggio: errori.map((e) => e.messaggio).join(" "),
            dettagli: errori,
        });
        return;
    }
    next();
}
