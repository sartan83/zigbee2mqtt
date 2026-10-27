import {describe, expect, it} from "vitest";
import {LISTINO} from "../data/listino.js";
import {
    arrotonda2,
    calcola,
    calcolaCorrenteInstallata,
    calcolaIvaCentesimi,
    ErroreCalcolo,
    euroInCentesimi,
    selezionaMagnetotermico,
} from "../services/calcolatore.js";

const TAGLIE = LISTINO.regole_elettriche.taglie_magnetotermico_a;

const base = {numero_interruttori_gewiss: 10, potenza_totale_kw: 4.5, numero_punti_luce: 12, superficie_mq: 85, tipo_impianto: "residenziale"};

/** Listino di prova con regole sostituite, per verificare che il motore legga solo dai dati. */
function listinoCon(modifiche) {
    return {
        ...LISTINO,
        ...modifiche,
        regole_elettriche: {...LISTINO.regole_elettriche, ...modifiche.regole_elettriche},
        iva: {...LISTINO.iva, ...modifiche.iva},
    };
}

describe("corrente e magnetotermico", () => {
    it("4,5 kW monofase → 19,57 A → magnetotermico 20 A", () => {
        const r = calcola(base);
        expect(r.corrente_totale_a).toBe(19.57);
        expect(r.magnetotermico_a).toBe(20);
    });

    it("applica il fattore di contemporaneità 0,8 alla corrente contemporanea", () => {
        const r = calcola(base);
        expect(r.fattore_contemporaneita).toBe(0.8);
        expect(r.corrente_contemporanea_a).toBe(15.65);
    });

    it("I = P × 1000 / 230", () => {
        expect(calcolaCorrenteInstallata(2.3, 230)).toBeCloseTo(10, 10);
        expect(calcolaCorrenteInstallata(0, 230)).toBe(0);
    });

    it.each([
        [0, 6],
        [0.01, 6],
        [6, 6],
        [6.01, 10],
        [16, 16],
        [16.004, 16],
        [16.01, 20],
        [19.57, 20],
        [40.5, 63],
        [63, 63],
    ])("corrente %s A → taglia %s A", (corrente, taglia) => {
        expect(selezionaMagnetotermico(corrente, TAGLIE)).toBe(taglia);
    });

    it("oltre 63 A solleva ErroreCalcolo FUORI_TAGLIA", () => {
        expect(() => selezionaMagnetotermico(63.01, TAGLIE)).toThrow(ErroreCalcolo);
        try {
            calcola({...base, potenza_totale_kw: 100});
            expect.unreachable();
        } catch (errore) {
            expect(errore).toBeInstanceOf(ErroreCalcolo);
            expect(errore.codice).toBe("FUORI_TAGLIA");
            expect(errore.message).toMatch(/63 A/);
        }
    });

    it("con base_dimensionamento 'contemporanea' la taglia segue la corrente × Kc", () => {
        const listino = listinoCon({regole_elettriche: {base_dimensionamento: "contemporanea"}});
        const r = calcola(base, listino);
        expect(r.corrente_totale_a).toBe(19.57);
        expect(r.magnetotermico_a).toBe(16);
    });
});

describe("preventivo", () => {
    it("costo = interruttori × prezzo + punti luce × costo punto + quota fissa, più IVA 22%", () => {
        const r = calcola(base);
        expect(r.costo_materiali).toBe(125); // 10 × 12,50
        expect(r.costo_manodopera).toBe(570); // 12 × 35 + 150
        expect(r.imponibile).toBe(695);
        expect(r.aliquota_iva).toBe(22);
        expect(r.iva).toBe(152.9);
        expect(r.totale).toBe(847.9);
    });

    it("usa i prezzi della tipologia commerciale", () => {
        const r = calcola({...base, tipo_impianto: "commerciale"});
        expect(r.costo_materiali).toBe(189); // 10 × 18,90
        expect(r.costo_manodopera).toBe(876); // 12 × 48 + 300
        expect(r.iva).toBe(234.3);
        expect(r.totale).toBe(1299.3);
    });

    it("impianto a zero: resta solo la quota fissa", () => {
        const r = calcola({
            numero_interruttori_gewiss: 0,
            potenza_totale_kw: 0,
            numero_punti_luce: 0,
            superficie_mq: 0,
            tipo_impianto: "residenziale",
        });
        expect(r.corrente_totale_a).toBe(0);
        expect(r.magnetotermico_a).toBe(6);
        expect(r.costo_materiali).toBe(0);
        expect(r.costo_manodopera).toBe(150);
        expect(r.iva).toBe(33);
        expect(r.totale).toBe(183);
        expect(r.materiali.map((m) => m.codice)).toEqual(["GW-MTC-1PN-C6"]);
    });

    it("valori grandi: nessuna perdita di precisione sugli importi", () => {
        const r = calcola({
            numero_interruttori_gewiss: 1000,
            potenza_totale_kw: 14.49,
            numero_punti_luce: 5000,
            superficie_mq: 100000,
            tipo_impianto: "commerciale",
        });
        expect(r.magnetotermico_a).toBe(63);
        expect(r.costo_materiali).toBe(18900);
        expect(r.costo_manodopera).toBe(240300);
        expect(r.iva).toBe(57024);
        expect(r.totale).toBe(316224);
    });

    it("tipo impianto non previsto dal listino → ErroreCalcolo", () => {
        expect(() => calcola({...base, tipo_impianto: "industriale"})).toThrow(/non previsto/);
        expect(() => calcola({...base, tipo_impianto: "toString"})).toThrow(ErroreCalcolo);
    });
});

describe("arrotondamenti", () => {
    it("IVA arrotondata al centesimo per eccesso da 0,5 (half-up)", () => {
        expect(calcolaIvaCentesimi(25, 22)).toBe(6); // 5,5 → 6
        expect(calcolaIvaCentesimi(31890, 22)).toBe(7016); // 7015,8 → 7016
        expect(calcolaIvaCentesimi(66360, 22)).toBe(14599); // 14599,2 → 14599
        expect(calcolaIvaCentesimi(0, 22)).toBe(0);
    });

    it("IVA con mezzo centesimo nel preventivo completo", () => {
        // Interruttore a 0,25 € e quota fissa nulla: imponibile 0,25 € → IVA 0,055 → 0,06 €.
        const tipi = {
            residenziale: {
                ...LISTINO.tipi_impianto.residenziale,
                interruttore: {...LISTINO.tipi_impianto.residenziale.interruttore, prezzo_unitario: 0.25},
                quota_fissa: 0,
            },
        };
        const r = calcola({...base, numero_interruttori_gewiss: 1, numero_punti_luce: 0}, listinoCon({tipi_impianto: tipi}));
        expect(r.imponibile).toBe(0.25);
        expect(r.iva).toBe(0.06);
        expect(r.totale).toBe(0.31);
    });

    it("importi con decimali non rappresentabili in binario restano esatti al centesimo", () => {
        // 3 × 18,90 in virgola mobile vale 56,699999…: in centesimi è esatto.
        const r = calcola({...base, tipo_impianto: "commerciale", numero_interruttori_gewiss: 3});
        expect(r.costo_materiali).toBe(56.7);
        expect(euroInCentesimi(0.1 + 0.2)).toBe(30);
        expect(arrotonda2(1.005)).toBe(1.01);
    });
});

describe("lista materiali", () => {
    it("quantità calcolate da interruttori, punti luce e superficie", () => {
        const r = calcola(base);
        expect(r.materiali).toEqual([
            expect.objectContaining({
                codice: "GW-CHORUS-INT-1P16",
                serie: "Chorus",
                quantita: 10,
                unita: "pz",
                prezzo_unitario: 12.5,
                importo: 125,
                compreso_in: null,
            }),
            expect.objectContaining({codice: "GW-MTC-1PN-C20", quantita: 1, compreso_in: "quota_fissa"}),
            // (12 punti × 12 m + 10 interruttori × 4 m) × 3 conduttori = 552 m, sezione 2,5 mm² per 20 A
            expect.objectContaining({codice: "GW-CAVO-FS17-25", quantita: 552, unita: "m", compreso_in: "costo_punto_luce"}),
            // 85 m² × 0,8 m/m² = 68 m
            expect.objectContaining({codice: "GW-DLP-CAN-40X17", quantita: 68, unita: "m"}),
        ]);
    });

    it("la somma degli importi dei materiali è uguale al costo materiali", () => {
        const r = calcola({...base, tipo_impianto: "commerciale", numero_interruttori_gewiss: 7});
        const somma = r.materiali.reduce((tot, m) => tot + euroInCentesimi(m.importo), 0) / 100;
        expect(somma).toBe(r.costo_materiali);
    });

    it("serie Gewiss dipendente dal tipo di impianto", () => {
        expect(calcola({...base, tipo_impianto: "commerciale"}).materiali[0].serie).toBe("System");
    });

    it("arrotonda i metri al metro superiore", () => {
        const r = calcola({...base, superficie_mq: 10.1});
        expect(r.materiali.find((m) => m.unita === "m" && m.codice.startsWith("GW-DLP")).quantita).toBe(9); // 8,08 → 9
    });

    it("la sezione del cavo segue la taglia del magnetotermico", () => {
        const sezione = (kw) => calcola({...base, potenza_totale_kw: kw}).materiali.find((m) => m.codice.startsWith("GW-CAVO")).descrizione;
        expect(sezione(3)).toMatch(/1,5 mm²/);
        expect(sezione(5.5)).toMatch(/4 mm²/);
        expect(sezione(14)).toMatch(/16 mm²/);
    });
});
