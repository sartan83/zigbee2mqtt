/**
 * Test di non regressione sui casi di riferimento di test/golden/casi.json.
 * Popolare il file con gli output del configuratore legacy (origine "legacy")
 * per verificare che il nuovo motore produca gli stessi risultati.
 */

import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";
import {calcola, ErroreCalcolo} from "../services/calcolatore.js";

const golden = JSON.parse(readFileSync(new URL("./golden/casi.json", import.meta.url), "utf8"));
const CAMPI_CORRENTE = new Set(["corrente_totale_a", "corrente_contemporanea_a"]);

describe("golden: casi di riferimento", () => {
    it("il file contiene casi con id univoci", () => {
        expect(golden.casi.length).toBeGreaterThan(0);
        expect(new Set(golden.casi.map((c) => c.id)).size).toBe(golden.casi.length);
    });

    it.each(golden.casi.map((c) => [`${c.id} [${c.origine}] — ${c.descrizione}`, c]))("%s", (_nome, caso) => {
        if (caso.atteso_errore) {
            expect(() => calcola(caso.input)).toThrow(ErroreCalcolo);
            expect(() => calcola(caso.input)).toThrow(expect.objectContaining(caso.atteso_errore));
            return;
        }

        const risultato = calcola(caso.input);
        const {materiali: materialiAttesi, ...campiAttesi} = caso.atteso;

        for (const [campo, valore] of Object.entries(campiAttesi)) {
            const tolleranza = CAMPI_CORRENTE.has(campo) ? golden.tolleranza_correnti : golden.tolleranza_importi;
            expect(risultato[campo], `${caso.id}.${campo}`).toBeTypeOf("number");
            expect(Math.abs(risultato[campo] - valore), `${caso.id}.${campo}: atteso ${valore}, ottenuto ${risultato[campo]}`).toBeLessThanOrEqual(
                tolleranza,
            );
        }

        if (materialiAttesi) {
            expect(risultato.materiali.map(({codice, quantita}) => ({codice, quantita}))).toEqual(materialiAttesi);
        }
    });
});
