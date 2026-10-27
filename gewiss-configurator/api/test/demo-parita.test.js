/**
 * La modalità demo della SPA (webapp/demo.js) deve restituire gli stessi
 * risultati del motore dell'API con il listino di default.
 */

import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";
import {calcolaDemo} from "../../webapp/demo.js";
import {calcola} from "../services/calcolatore.js";

const golden = JSON.parse(readFileSync(new URL("./golden/casi.json", import.meta.url), "utf8"));

describe("parità modalità demo ↔ API", () => {
    it.each(golden.casi.filter((c) => !c.atteso_errore).map((c) => [c.id, c.input]))("%s", (_id, input) => {
        const {listino_versione: _a, ...api} = calcola(input);
        const {listino_versione: _b, ...demo} = calcolaDemo(input);
        expect(demo).toEqual(api);
    });

    it("stesso errore FUORI_TAGLIA", () => {
        const input = {numero_interruttori_gewiss: 1, potenza_totale_kw: 20, numero_punti_luce: 1, superficie_mq: 1, tipo_impianto: "residenziale"};
        expect(() => calcolaDemo(input)).toThrow(expect.objectContaining({codice: "FUORI_TAGLIA"}));
        expect(() => calcola(input)).toThrow(expect.objectContaining({codice: "FUORI_TAGLIA"}));
    });
});
