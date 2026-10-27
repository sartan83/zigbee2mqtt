/**
 * Motore di calcolo del configuratore Gewiss.
 *
 * Modulo PURO: nessuna dipendenza HTTP, nessun I/O, nessuno stato globale.
 * Riceve gli input dell'impianto e un listino (default: data/listino.js) e
 * restituisce dimensionamento elettrico, preventivo e lista materiali.
 *
 * Per sostituire le formule con quelle del configuratore legacy:
 *  - prezzi, taglie e coefficienti → data/listino.js;
 *  - formule → le singole funzioni esportate qui sotto (una per passo di calcolo);
 *  - verifica di non regressione → test/golden/casi.json.
 *
 * Convenzioni:
 *  - importi calcolati in CENTESIMI interi, per evitare errori di virgola mobile,
 *    e convertiti in euro (2 decimali) solo in uscita;
 *  - arrotondamento commerciale "half-up" (0,5 centesimi → per eccesso);
 *  - correnti espresse in ampere, arrotondate a 2 decimali in uscita.
 */

import {LISTINO} from "../data/listino.js";

/** Errore di dominio: input coerente nel formato ma non calcolabile (es. corrente oltre la taglia massima). */
export class ErroreCalcolo extends Error {
    /**
     * @param {string} codice codice macchina dell'errore (es. "FUORI_TAGLIA")
     * @param {string} messaggio descrizione in italiano per l'utente
     */
    constructor(codice, messaggio) {
        super(messaggio);
        this.name = "ErroreCalcolo";
        this.codice = codice;
    }
}

/** Arrotonda a 2 decimali (half-up), compensando la rappresentazione binaria dei decimali. */
export function arrotonda2(valore) {
    return Math.round((valore + Number.EPSILON) * 100) / 100;
}

/** Converte un importo in euro in centesimi interi. */
export function euroInCentesimi(euro) {
    return Math.round((euro + Number.EPSILON) * 100);
}

/** Converte centesimi interi in euro con 2 decimali. */
export function centesimiInEuro(centesimi) {
    return centesimi / 100;
}

/**
 * Corrente totale installata di un impianto monofase: I = P / V.
 * @param {number} potenzaKw potenza totale installata [kW]
 * @param {number} tensioneV tensione nominale [V]
 * @returns {number} corrente [A], non arrotondata
 */
export function calcolaCorrenteInstallata(potenzaKw, tensioneV) {
    return (potenzaKw * 1000) / tensioneV;
}

/**
 * Corrente contemporanea: I_c = I × Kc.
 * @param {number} correnteA corrente installata [A]
 * @param {number} fattoreContemporaneita Kc, tra 0 e 1
 */
export function calcolaCorrenteContemporanea(correnteA, fattoreContemporaneita) {
    return correnteA * fattoreContemporaneita;
}

/**
 * Taglia standard del magnetotermico: la più piccola taglia In ≥ corrente.
 * Una corrente pari a una taglia standard seleziona quella taglia (es. 16,00 A → 16 A).
 * @param {number} correnteA corrente di dimensionamento [A]
 * @param {readonly number[]} taglie taglie disponibili in ordine crescente [A]
 * @returns {number} taglia [A]
 * @throws {ErroreCalcolo} se la corrente supera la taglia massima disponibile
 */
export function selezionaMagnetotermico(correnteA, taglie) {
    // Il confronto avviene sulla corrente arrotondata a 2 decimali, la stessa mostrata all'utente.
    const corrente = arrotonda2(correnteA);
    const taglia = taglie.find((t) => t >= corrente);

    if (taglia === undefined) {
        const massima = taglie[taglie.length - 1];
        throw new ErroreCalcolo(
            "FUORI_TAGLIA",
            `La corrente di dimensionamento (${corrente} A) supera la taglia massima monofase di ${massima} A: valutare un impianto trifase o la suddivisione in più linee.`,
        );
    }

    return taglia;
}

/**
 * IVA in centesimi, arrotondata half-up al centesimo.
 * @param {number} imponibileCentesimi imponibile in centesimi interi
 * @param {number} aliquotaPercentuale aliquota (es. 22)
 */
export function calcolaIvaCentesimi(imponibileCentesimi, aliquotaPercentuale) {
    return Math.round((imponibileCentesimi * aliquotaPercentuale) / 100);
}

/**
 * Lista materiali calcolata dalle quantità dell'impianto.
 * Le voci non a prezzo diretto riportano in `compreso_in` la voce di costo che le comprende.
 */
export function calcolaMateriali(input, regoleTipo, regoleElettriche, articoliComuni, magnetotermicoA) {
    const {numero_interruttori_gewiss: interruttori, numero_punti_luce: puntiLuce, superficie_mq: superficie} = input;
    const prezzoInterruttoreCent = euroInCentesimi(regoleTipo.interruttore.prezzo_unitario);

    // Cavo: metri di tracciato × conduttori (F + N + PE), arrotondati al metro superiore.
    const metriTracciato = puntiLuce * regoleTipo.metri_tracciato_per_punto_luce + interruttori * regoleTipo.metri_tracciato_per_interruttore;
    const metriCavo = Math.ceil(arrotonda2(metriTracciato * regoleElettriche.conduttori_per_linea));
    const sezioneCavo = regoleElettriche.sezione_cavo_per_taglia_mmq[magnetotermicoA];

    // Canalina: metri per m² di superficie, arrotondati al metro superiore.
    const metriCanalina = Math.ceil(arrotonda2(superficie * regoleTipo.metri_canalina_per_mq));

    const materiali = [
        {
            codice: regoleTipo.interruttore.codice,
            descrizione: regoleTipo.interruttore.descrizione,
            serie: regoleTipo.interruttore.serie,
            quantita: interruttori,
            unita: "pz",
            prezzo_unitario: centesimiInEuro(prezzoInterruttoreCent),
            importo: centesimiInEuro(interruttori * prezzoInterruttoreCent),
            compreso_in: null,
        },
        {
            codice: `${articoliComuni.magnetotermico.codice}-C${magnetotermicoA}`,
            descrizione: `${articoliComuni.magnetotermico.descrizione} ${magnetotermicoA} A`,
            quantita: 1,
            unita: "pz",
            prezzo_unitario: 0,
            importo: 0,
            compreso_in: "quota_fissa",
        },
        {
            codice: `${articoliComuni.cavo.codice}-${String(sezioneCavo).replace(".", "")}`,
            descrizione: `${articoliComuni.cavo.descrizione} ${String(sezioneCavo).replace(".", ",")} mm²`,
            quantita: metriCavo,
            unita: "m",
            prezzo_unitario: 0,
            importo: 0,
            compreso_in: "costo_punto_luce",
        },
        {
            codice: regoleTipo.canalina.codice,
            descrizione: regoleTipo.canalina.descrizione,
            quantita: metriCanalina,
            unita: "m",
            prezzo_unitario: 0,
            importo: 0,
            compreso_in: "costo_punto_luce",
        },
    ];

    // Il magnetotermico generale è sempre presente; le altre voci solo se la quantità è positiva.
    return materiali.filter((voce) => voce.quantita > 0 || voce.compreso_in === "quota_fissa");
}

/**
 * Calcolo completo: dimensionamento, preventivo e lista materiali.
 *
 * @param {object} input
 * @param {number} input.numero_interruttori_gewiss numero di interruttori (intero ≥ 0)
 * @param {number} input.potenza_totale_kw potenza totale installata [kW] (≥ 0)
 * @param {number} input.numero_punti_luce numero di punti luce (intero ≥ 0)
 * @param {number} input.superficie_mq superficie servita [m²] (≥ 0)
 * @param {"residenziale"|"commerciale"} input.tipo_impianto tipologia di impianto
 * @param {object} [listino] listino da utilizzare (default: data/listino.js)
 */
export function calcola(input, listino = LISTINO) {
    if (!Object.hasOwn(listino.tipi_impianto, input.tipo_impianto)) {
        throw new ErroreCalcolo("TIPO_IMPIANTO_NON_VALIDO", `Tipo di impianto non previsto dal listino: "${input.tipo_impianto}".`);
    }
    const regoleTipo = listino.tipi_impianto[input.tipo_impianto];
    const regole = listino.regole_elettriche;

    // 1. Dimensionamento elettrico (monofase).
    const correnteInstallata = calcolaCorrenteInstallata(input.potenza_totale_kw, regole.tensione_v);
    const correnteContemporanea = calcolaCorrenteContemporanea(correnteInstallata, regole.fattore_contemporaneita);
    const correnteDimensionamento = regole.base_dimensionamento === "contemporanea" ? correnteContemporanea : correnteInstallata;
    const magnetotermicoA = selezionaMagnetotermico(correnteDimensionamento, regole.taglie_magnetotermico_a);

    // 2. Preventivo, in centesimi interi.
    const materialiCent = input.numero_interruttori_gewiss * euroInCentesimi(regoleTipo.interruttore.prezzo_unitario);
    const manodoperaCent = input.numero_punti_luce * euroInCentesimi(regoleTipo.costo_punto_luce) + euroInCentesimi(regoleTipo.quota_fissa);
    const imponibileCent = materialiCent + manodoperaCent;
    const ivaCent = calcolaIvaCentesimi(imponibileCent, listino.iva.aliquota_percentuale);

    // 3. Lista materiali.
    const materiali = calcolaMateriali(input, regoleTipo, regole, listino.articoli_comuni, magnetotermicoA);

    return {
        tipo_impianto: input.tipo_impianto,
        listino_versione: listino.versione,
        corrente_totale_a: arrotonda2(correnteInstallata),
        corrente_contemporanea_a: arrotonda2(correnteContemporanea),
        fattore_contemporaneita: regole.fattore_contemporaneita,
        magnetotermico_a: magnetotermicoA,
        costo_materiali: centesimiInEuro(materialiCent),
        costo_manodopera: centesimiInEuro(manodoperaCent),
        imponibile: centesimiInEuro(imponibileCent),
        aliquota_iva: listino.iva.aliquota_percentuale,
        iva: centesimiInEuro(ivaCent),
        totale: centesimiInEuro(imponibileCent + ivaCent),
        materiali,
    };
}
