import request from "supertest";
import {describe, expect, it} from "vitest";
import {creaApp, origineCors} from "../app.js";
import {LISTINO} from "../data/listino.js";

const app = creaApp({rateLimitMax: 10_000});
const valido = {numero_interruttori_gewiss: 10, potenza_totale_kw: 4.5, numero_punti_luce: 12, superficie_mq: 85, tipo_impianto: "residenziale"};

describe("POST /api/calcolo", () => {
    it("200 con payload valido", async () => {
        const res = await request(app).post("/api/calcolo").send(valido).expect(200).expect("Content-Type", /json/);
        expect(res.body).toMatchObject({
            corrente_totale_a: 19.57,
            magnetotermico_a: 20,
            costo_materiali: 125,
            costo_manodopera: 570,
            iva: 152.9,
            totale: 847.9,
        });
        expect(Array.isArray(res.body.materiali)).toBe(true);
        expect(res.body.materiali.length).toBe(4);
    });

    it("200 con tutti i valori a zero", async () => {
        const res = await request(app)
            .post("/api/calcolo")
            .send({...valido, numero_interruttori_gewiss: 0, potenza_totale_kw: 0, numero_punti_luce: 0, superficie_mq: 0})
            .expect(200);
        expect(res.body.totale).toBe(183);
    });

    it.each(["numero_interruttori_gewiss", "potenza_totale_kw", "numero_punti_luce", "superficie_mq", "tipo_impianto"])(
        "400 se manca %s",
        async (campo) => {
            const {[campo]: _omesso, ...corpo} = valido;
            const res = await request(app).post("/api/calcolo").send(corpo).expect(400);
            expect(res.body.codice).toBe("INPUT_NON_VALIDO");
            expect(res.body.messaggio).toMatch(/campo obbligatorio/);
            expect(res.body.dettagli).toEqual([expect.objectContaining({campo})]);
        },
    );

    it.each([
        ["numero_interruttori_gewiss", -1, /non può essere negativo/],
        ["potenza_totale_kw", -0.5, /non può essere negativo/],
        ["numero_punti_luce", -3, /non può essere negativo/],
        ["superficie_mq", -10, /non può essere negativo/],
        ["potenza_totale_kw", "4.5", /deve essere un numero/],
        ["numero_interruttori_gewiss", "dieci", /deve essere un numero/],
        ["superficie_mq", true, /deve essere un numero/],
        ["numero_punti_luce", [12], /deve essere un numero/],
        ["numero_interruttori_gewiss", 2.5, /intero/],
        ["numero_punti_luce", 1.1, /intero/],
        ["numero_interruttori_gewiss", 1001, /compreso tra 0 e 1000/],
        ["superficie_mq", 1e9, /compreso tra/],
        ["tipo_impianto", "industriale", /valori ammessi residenziale, commerciale/],
        ["tipo_impianto", 1, /valori ammessi/],
    ])("400 se %s = %j", async (campo, valore, messaggio) => {
        const res = await request(app)
            .post("/api/calcolo")
            .send({...valido, [campo]: valore})
            .expect(400);
        expect(res.body.messaggio).toMatch(messaggio);
        expect(res.body.dettagli[0].campo).toBe(campo);
    });

    it("400 con più errori riportati insieme", async () => {
        const res = await request(app).post("/api/calcolo").send({potenza_totale_kw: -1}).expect(400);
        expect(res.body.dettagli.map((d) => d.campo).sort()).toEqual([
            "numero_interruttori_gewiss",
            "numero_punti_luce",
            "potenza_totale_kw",
            "superficie_mq",
            "tipo_impianto",
        ]);
    });

    it("400 con campo non previsto", async () => {
        const res = await request(app)
            .post("/api/calcolo")
            .send({...valido, sconto: 50})
            .expect(400);
        expect(res.body.messaggio).toMatch(/Campo non previsto: "sconto"/);
    });

    it("400 con JSON malformato", async () => {
        const res = await request(app).post("/api/calcolo").set("Content-Type", "application/json").send('{"potenza_totale_kw": 4,').expect(400);
        expect(res.body.codice).toBe("JSON_NON_VALIDO");
    });

    it("400 con corpo assente o non oggetto", async () => {
        await request(app).post("/api/calcolo").expect(400);
        const res = await request(app).post("/api/calcolo").send([valido]).expect(400);
        expect(res.body.messaggio).toMatch(/oggetto JSON/);
    });

    it("413 con corpo troppo grande", async () => {
        const res = await request(app)
            .post("/api/calcolo")
            .send({...valido, extra: "x".repeat(20_000)})
            .expect(413);
        expect(res.body.codice).toBe("CORPO_TROPPO_GRANDE");
    });

    it("422 se la corrente supera la taglia massima monofase", async () => {
        const res = await request(app)
            .post("/api/calcolo")
            .send({...valido, potenza_totale_kw: 20})
            .expect(422);
        expect(res.body.codice).toBe("FUORI_TAGLIA");
        expect(res.body.messaggio).toMatch(/trifase/);
    });
});

describe("GET /api/health e /api/listino", () => {
    it("health restituisce stato ok", async () => {
        const res = await request(app).get("/api/health").expect(200);
        expect(res.body).toMatchObject({stato: "ok", listino_versione: LISTINO.versione});
    });

    it("listino restituisce il listino attivo", async () => {
        const res = await request(app).get("/api/listino").expect(200);
        expect(res.body).toEqual(JSON.parse(JSON.stringify(LISTINO)));
        expect(Object.keys(res.body.tipi_impianto)).toEqual(["residenziale", "commerciale"]);
    });
});

describe("404 e sicurezza", () => {
    it("404 su route inesistente", async () => {
        const res = await request(app).get("/api/inesistente").expect(404);
        expect(res.body).toMatchObject({codice: "NON_TROVATO"});
        expect(res.body.messaggio).toMatch(/GET \/api\/inesistente/);
    });

    it("404 su metodo non previsto", async () => {
        await request(app).get("/api/calcolo").expect(404);
        await request(app).post("/").send({}).expect(404);
    });

    it("CORS abilitato con preflight", async () => {
        const res = await request(app)
            .options("/api/calcolo")
            .set("Origin", "http://localhost:8080")
            .set("Access-Control-Request-Method", "POST")
            .set("Access-Control-Request-Headers", "Content-Type")
            .expect(204);
        expect(res.headers["access-control-allow-origin"]).toBe("*");
        expect(res.headers["access-control-allow-methods"]).toMatch(/POST/);
    });

    it("CORS limitato alle origini configurate", async () => {
        const appRistretta = creaApp({corsOrigin: origineCors("http://consentita.local, http://altra.local")});
        const ok = await request(appRistretta).get("/api/health").set("Origin", "http://consentita.local");
        expect(ok.headers["access-control-allow-origin"]).toBe("http://consentita.local");
        const ko = await request(appRistretta).get("/api/health").set("Origin", "http://estranea.local");
        expect(ko.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("origineCors interpreta la variabile d'ambiente", () => {
        expect(origineCors(undefined)).toBe("*");
        expect(origineCors(" * ")).toBe("*");
        expect(origineCors("http://a.it,,http://b.it ")).toEqual(["http://a.it", "http://b.it"]);
    });

    it("header di sicurezza helmet e nessun x-powered-by", async () => {
        const res = await request(app).get("/api/health");
        expect(res.headers["x-content-type-options"]).toBe("nosniff");
        expect(res.headers["content-security-policy"]).toBeDefined();
        expect(res.headers["x-powered-by"]).toBeUndefined();
    });

    it("rate limiting: 429 oltre il limite", async () => {
        const appLimitata = creaApp({rateLimitMax: 2, rateLimitFinestraMs: 60_000});
        await request(appLimitata).get("/api/health").expect(200);
        await request(appLimitata).get("/api/health").expect(200);
        const res = await request(appLimitata).get("/api/health").expect(429);
        expect(res.body.codice).toBe("TROPPE_RICHIESTE");
    });
});
