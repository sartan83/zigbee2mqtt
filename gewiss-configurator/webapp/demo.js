/**
 * Modalità demo lato client: replica del motore di calcolo dell'API
 * (api/services/calcolatore.js + api/data/listino.js) con il listino di default,
 * usata solo quando l'API non è raggiungibile. I valori sono indicativi.
 *
 * La parità con il motore dell'API è verificata da api/test/demo-parita.test.js:
 * se si modifica il listino o le formule dell'API, aggiornare anche questo file.
 */

export const LISTINO_DEMO = Object.freeze({
    versione: "2026.1-default (demo)",
    tensione_v: 230,
    fattore_contemporaneita: 0.8,
    base_dimensionamento: "installata",
    taglie_magnetotermico_a: [6, 10, 16, 20, 25, 32, 40, 63],
    sezione_cavo_per_taglia_mmq: {6: 1.5, 10: 1.5, 16: 1.5, 20: 2.5, 25: 4, 32: 6, 40: 10, 63: 16},
    conduttori_per_linea: 3,
    aliquota_iva: 22,
    tipi: {
        residenziale: {
            interruttore: {
                codice: "GW-CHORUS-INT-1P16",
                descrizione: "Interruttore Gewiss serie Chorus 1P 16 AX",
                serie: "Chorus",
                prezzo_unitario: 12.5,
            },
            costo_punto_luce: 35,
            quota_fissa: 150,
            metri_tracciato_per_punto_luce: 12,
            metri_tracciato_per_interruttore: 4,
            metri_canalina_per_mq: 0.8,
            canalina: {codice: "GW-DLP-CAN-40X17", descrizione: "Canalina Gewiss DLP 40×17 mm"},
        },
        commerciale: {
            interruttore: {
                codice: "GW-SYSTEM-INT-1P16",
                descrizione: "Interruttore Gewiss serie System 1P 16 AX",
                serie: "System",
                prezzo_unitario: 18.9,
            },
            costo_punto_luce: 48,
            quota_fissa: 300,
            metri_tracciato_per_punto_luce: 15,
            metri_tracciato_per_interruttore: 5,
            metri_canalina_per_mq: 1,
            canalina: {codice: "GW-DLP-CAN-80X20", descrizione: "Canalina Gewiss DLP 80×20 mm"},
        },
    },
    magnetotermico: {codice: "GW-MTC-1PN", descrizione: "Magnetotermico Gewiss MTC 1P+N curva C 4,5 kA"},
    cavo: {codice: "GW-CAVO-FS17", descrizione: "Cavo unipolare FS17 450/750 V"},
});

const arrotonda2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const cent = (euro) => Math.round((euro + Number.EPSILON) * 100);

/**
 * Calcolo demo con la stessa forma di risposta di POST /api/calcolo.
 * Errori di dominio sollevati come Error con proprietà `codice` (es. "FUORI_TAGLIA").
 */
export function calcolaDemo(input, l = LISTINO_DEMO) {
    const tipo = l.tipi[input.tipo_impianto];
    if (!tipo) {
        throw Object.assign(new Error(`Tipo di impianto non previsto: "${input.tipo_impianto}".`), {codice: "TIPO_IMPIANTO_NON_VALIDO"});
    }

    const correnteInstallata = (input.potenza_totale_kw * 1000) / l.tensione_v;
    const correnteContemporanea = correnteInstallata * l.fattore_contemporaneita;
    const base = arrotonda2(l.base_dimensionamento === "contemporanea" ? correnteContemporanea : correnteInstallata);
    const taglia = l.taglie_magnetotermico_a.find((t) => t >= base);
    if (taglia === undefined) {
        const massima = l.taglie_magnetotermico_a[l.taglie_magnetotermico_a.length - 1];
        throw Object.assign(
            new Error(
                `La corrente di dimensionamento (${base} A) supera la taglia massima monofase di ${massima} A: valutare un impianto trifase o la suddivisione in più linee.`,
            ),
            {codice: "FUORI_TAGLIA"},
        );
    }

    const prezzoInt = cent(tipo.interruttore.prezzo_unitario);
    const materialiCent = input.numero_interruttori_gewiss * prezzoInt;
    const manodoperaCent = input.numero_punti_luce * cent(tipo.costo_punto_luce) + cent(tipo.quota_fissa);
    const imponibileCent = materialiCent + manodoperaCent;
    const ivaCent = Math.round((imponibileCent * l.aliquota_iva) / 100);

    const metriTracciato =
        input.numero_punti_luce * tipo.metri_tracciato_per_punto_luce + input.numero_interruttori_gewiss * tipo.metri_tracciato_per_interruttore;
    const sezione = l.sezione_cavo_per_taglia_mmq[taglia];
    const materiali = [
        {
            codice: tipo.interruttore.codice,
            descrizione: tipo.interruttore.descrizione,
            serie: tipo.interruttore.serie,
            quantita: input.numero_interruttori_gewiss,
            unita: "pz",
            prezzo_unitario: prezzoInt / 100,
            importo: materialiCent / 100,
            compreso_in: null,
        },
        {
            codice: `${l.magnetotermico.codice}-C${taglia}`,
            descrizione: `${l.magnetotermico.descrizione} ${taglia} A`,
            quantita: 1,
            unita: "pz",
            prezzo_unitario: 0,
            importo: 0,
            compreso_in: "quota_fissa",
        },
        {
            codice: `${l.cavo.codice}-${String(sezione).replace(".", "")}`,
            descrizione: `${l.cavo.descrizione} ${String(sezione).replace(".", ",")} mm²`,
            quantita: Math.ceil(arrotonda2(metriTracciato * l.conduttori_per_linea)),
            unita: "m",
            prezzo_unitario: 0,
            importo: 0,
            compreso_in: "costo_punto_luce",
        },
        {
            codice: tipo.canalina.codice,
            descrizione: tipo.canalina.descrizione,
            quantita: Math.ceil(arrotonda2(input.superficie_mq * tipo.metri_canalina_per_mq)),
            unita: "m",
            prezzo_unitario: 0,
            importo: 0,
            compreso_in: "costo_punto_luce",
        },
    ].filter((v) => v.quantita > 0 || v.compreso_in === "quota_fissa");

    return {
        tipo_impianto: input.tipo_impianto,
        listino_versione: l.versione,
        corrente_totale_a: arrotonda2(correnteInstallata),
        corrente_contemporanea_a: arrotonda2(correnteContemporanea),
        fattore_contemporaneita: l.fattore_contemporaneita,
        magnetotermico_a: taglia,
        costo_materiali: materialiCent / 100,
        costo_manodopera: manodoperaCent / 100,
        imponibile: imponibileCent / 100,
        aliquota_iva: l.aliquota_iva,
        iva: ivaCent / 100,
        totale: (imponibileCent + ivaCent) / 100,
        materiali,
    };
}
