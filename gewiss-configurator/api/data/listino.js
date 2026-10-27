/**
 * Listino prezzi e regole tecniche del configuratore Gewiss.
 *
 * Questo file contiene SOLO dati: nessuna logica di calcolo.
 * Per allineare il servizio al vecchio configuratore è sufficiente sostituire
 * i valori qui sotto con quelli legacy (prezzi, taglie, coefficienti), senza
 * toccare services/calcolatore.js.
 *
 * Tutti i prezzi sono in EURO, IVA esclusa.
 * I codici articolo sono segnaposto interni (prefisso "GW-"): sostituirli con i
 * codici del catalogo Gewiss effettivamente utilizzati.
 */

/** Versione del listino, restituita da GET /api/listino e nelle risposte di calcolo. */
export const VERSIONE_LISTINO = "2026.1-default";

/** Regole elettriche generali (impianto monofase). */
export const REGOLE_ELETTRICHE = Object.freeze({
    /** Tensione nominale monofase [V]. */
    tensione_v: 230,
    /** Fattore di contemporaneità (Kc) applicato alla corrente installata. */
    fattore_contemporaneita: 0.8,
    /**
     * Base di dimensionamento del magnetotermico:
     *  - "installata":    taglia scelta sulla corrente totale installata (P / V), più conservativa;
     *  - "contemporanea": taglia scelta sulla corrente installata × Kc.
     * Default "installata": 4,5 kW → 19,57 A → magnetotermico 20 A.
     */
    base_dimensionamento: "installata",
    /** Taglie standard dei magnetotermici [A], in ordine crescente. */
    taglie_magnetotermico_a: Object.freeze([6, 10, 16, 20, 25, 32, 40, 63]),
    /**
     * Sezione del cavo di dorsale in funzione della taglia del magnetotermico [A → mm²].
     * Posa in tubo/canalina, cavo unipolare FS17, coordinamento Ib ≤ In ≤ Iz.
     */
    sezione_cavo_per_taglia_mmq: Object.freeze({6: 1.5, 10: 1.5, 16: 1.5, 20: 2.5, 25: 4, 32: 6, 40: 10, 63: 16}),
    /** Conduttori per linea monofase: fase + neutro + protezione (PE). */
    conduttori_per_linea: 3,
});

/** IVA applicata al preventivo. */
export const IVA = Object.freeze({
    aliquota_percentuale: 22,
});

/**
 * Listino per tipologia di impianto.
 *
 * Formula del preventivo (vedi services/calcolatore.js):
 *   costo_materiali  = numero_interruttori × prezzo_interruttore
 *   costo_manodopera = numero_punti_luce × costo_punto_luce + quota_fissa
 *   totale           = (costo_materiali + costo_manodopera) × (1 + IVA)
 *
 * Il costo del punto luce comprende cavi e canaline (riportati nella lista
 * materiali solo come quantità); la quota fissa comprende centralino e
 * magnetotermico generale.
 */
export const LISTINO_PER_TIPO = Object.freeze({
    residenziale: Object.freeze({
        etichetta: "Residenziale",
        interruttore: Object.freeze({
            codice: "GW-CHORUS-INT-1P16",
            descrizione: "Interruttore Gewiss serie Chorus 1P 16 AX",
            serie: "Chorus",
            prezzo_unitario: 12.5,
        }),
        costo_punto_luce: 35,
        quota_fissa: 150,
        /** Metri di tracciato per punto luce e per interruttore (dorsale + derivazione). */
        metri_tracciato_per_punto_luce: 12,
        metri_tracciato_per_interruttore: 4,
        /** Metri di canalina per m² di superficie servita. */
        metri_canalina_per_mq: 0.8,
        canalina: Object.freeze({codice: "GW-DLP-CAN-40X17", descrizione: "Canalina Gewiss DLP 40×17 mm"}),
    }),
    commerciale: Object.freeze({
        etichetta: "Commerciale",
        interruttore: Object.freeze({
            codice: "GW-SYSTEM-INT-1P16",
            descrizione: "Interruttore Gewiss serie System 1P 16 AX",
            serie: "System",
            prezzo_unitario: 18.9,
        }),
        costo_punto_luce: 48,
        quota_fissa: 300,
        metri_tracciato_per_punto_luce: 15,
        metri_tracciato_per_interruttore: 5,
        metri_canalina_per_mq: 1,
        canalina: Object.freeze({codice: "GW-DLP-CAN-80X20", descrizione: "Canalina Gewiss DLP 80×20 mm"}),
    }),
});

/** Articoli comuni a tutte le tipologie (codice segnaposto + descrizione). */
export const ARTICOLI_COMUNI = Object.freeze({
    magnetotermico: Object.freeze({codice: "GW-MTC-1PN", descrizione: "Magnetotermico Gewiss MTC 1P+N curva C 4,5 kA"}),
    cavo: Object.freeze({codice: "GW-CAVO-FS17", descrizione: "Cavo unipolare FS17 450/750 V"}),
});

/** Limiti di validazione degli input (protezione da valori non realistici). */
export const LIMITI_INPUT = Object.freeze({
    numero_interruttori_gewiss: Object.freeze({min: 0, max: 1000, intero: true}),
    potenza_totale_kw: Object.freeze({min: 0, max: 1000, intero: false}),
    numero_punti_luce: Object.freeze({min: 0, max: 5000, intero: true}),
    superficie_mq: Object.freeze({min: 0, max: 100000, intero: false}),
});

/** Listino completo, così come esposto da GET /api/listino. */
export const LISTINO = Object.freeze({
    versione: VERSIONE_LISTINO,
    valuta: "EUR",
    regole_elettriche: REGOLE_ELETTRICHE,
    iva: IVA,
    tipi_impianto: LISTINO_PER_TIPO,
    articoli_comuni: ARTICOLI_COMUNI,
    limiti_input: LIMITI_INPUT,
});

export default LISTINO;
