/**
 * Gestione centralizzata di 404 ed errori.
 * Ogni risposta di errore ha la forma: { errore, codice, messaggio, dettagli? }.
 */

import {ErroreCalcolo} from "../services/calcolatore.js";

/** 404 per qualsiasi route non definita. */
export function routeNonTrovata(req, res) {
    res.status(404).json({
        errore: "Risorsa non trovata",
        codice: "NON_TROVATO",
        messaggio: `Nessuna route per ${req.method} ${req.originalUrl}.`,
    });
}

/** Gestore errori finale: traduce gli errori noti in risposte HTTP, nasconde i dettagli di quelli imprevisti. */
// biome-ignore lint/correctness/noUnusedFunctionParameters: Express riconosce il gestore errori dai 4 parametri.
export function gestoreErrori(err, req, res, next) {
    if (err instanceof ErroreCalcolo) {
        res.status(422).json({errore: "Calcolo non eseguibile", codice: err.codice, messaggio: err.message});
        return;
    }

    // Errori di body-parser: JSON malformato o corpo troppo grande.
    if (err.type === "entity.parse.failed") {
        res.status(400).json({errore: "JSON non valido", codice: "JSON_NON_VALIDO", messaggio: "Il corpo della richiesta non è un JSON valido."});
        return;
    }
    if (err.type === "entity.too.large") {
        res.status(413).json({
            errore: "Richiesta troppo grande",
            codice: "CORPO_TROPPO_GRANDE",
            messaggio: "Il corpo della richiesta supera la dimensione massima.",
        });
        return;
    }

    const stato = Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (stato === 500) {
        console.error("[gewiss-configurator] errore non gestito:", err);
    }
    res.status(stato).json({
        errore: stato === 500 ? "Errore interno del server" : "Richiesta non valida",
        codice: stato === 500 ? "ERRORE_INTERNO" : "RICHIESTA_NON_VALIDA",
        messaggio: stato === 500 ? "Si è verificato un errore imprevisto." : err.message,
    });
}
