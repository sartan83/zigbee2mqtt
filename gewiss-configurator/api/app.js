/**
 * Costruzione dell'applicazione Express (senza avvio del server, così i test la usano con supertest).
 */

import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import {LISTINO} from "./data/listino.js";
import {gestoreErrori, routeNonTrovata} from "./middleware/errori.js";
import {creaRouterCalcolo} from "./routes/calcolo.js";

/**
 * Origini CORS da variabile d'ambiente: "*" (default) oppure elenco separato da virgole.
 * @param {string | undefined} valore
 */
export function origineCors(valore) {
    if (!valore || valore.trim() === "*") {
        return "*";
    }
    return valore
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);
}

/**
 * @param {object} [opzioni]
 * @param {string | string[]} [opzioni.corsOrigin] origini CORS ammesse
 * @param {number} [opzioni.rateLimitMax] richieste massime per finestra e per IP
 * @param {number} [opzioni.rateLimitFinestraMs] durata della finestra di rate limiting
 * @param {object} [opzioni.listino] listino da usare (default: data/listino.js)
 */
export function creaApp(opzioni = {}) {
    const {
        corsOrigin = origineCors(process.env.CORS_ORIGIN),
        rateLimitMax = Number(process.env.RATE_LIMIT_MAX) || 120,
        rateLimitFinestraMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
        listino = LISTINO,
    } = opzioni;

    const app = express();
    app.disable("x-powered-by");
    app.set("trust proxy", process.env.TRUST_PROXY === "true");

    app.use(helmet());
    app.use(cors({origin: corsOrigin, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"]}));
    app.use(
        "/api",
        rateLimit({
            windowMs: rateLimitFinestraMs,
            limit: rateLimitMax,
            standardHeaders: "draft-7",
            legacyHeaders: false,
            message: {errore: "Troppe richieste", codice: "TROPPE_RICHIESTE", messaggio: "Limite di richieste superato, riprovare tra poco."},
        }),
    );
    app.use(express.json({limit: "10kb", strict: true}));

    app.use("/api", creaRouterCalcolo(listino));

    app.use(routeNonTrovata);
    app.use(gestoreErrori);

    return app;
}
