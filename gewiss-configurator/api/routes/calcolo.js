/**
 * Endpoint del configuratore:
 *   GET  /api/health   stato del servizio
 *   GET  /api/listino  listino prezzi e regole attivi
 *   POST /api/calcolo  dimensionamento, preventivo e lista materiali
 */

import {Router} from "express";
import {LISTINO} from "../data/listino.js";
import {validaCalcolo} from "../middleware/validazione.js";
import {calcola} from "../services/calcolatore.js";

export function creaRouterCalcolo(listino = LISTINO) {
    const router = Router();

    router.get("/health", (_req, res) => {
        res.json({stato: "ok", servizio: "gewiss-configurator-api", listino_versione: listino.versione, timestamp: new Date().toISOString()});
    });

    router.get("/listino", (_req, res) => {
        res.json(listino);
    });

    // Gli ErroreCalcolo sollevati da calcola() arrivano al gestore errori centralizzato (Express 5 inoltra le eccezioni).
    router.post("/calcolo", validaCalcolo, (req, res) => {
        const {numero_interruttori_gewiss, potenza_totale_kw, numero_punti_luce, superficie_mq, tipo_impianto} = req.body;
        res.json(calcola({numero_interruttori_gewiss, potenza_totale_kw, numero_punti_luce, superficie_mq, tipo_impianto}, listino));
    });

    return router;
}
