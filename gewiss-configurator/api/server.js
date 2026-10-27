/**
 * Entry point dell'API del configuratore Gewiss.
 *
 * Variabili d'ambiente:
 *   PORT                   porta HTTP (default 3000)
 *   HOST                   interfaccia di ascolto (default 0.0.0.0)
 *   CORS_ORIGIN            "*" (default) o elenco di origini separate da virgola
 *   RATE_LIMIT_MAX         richieste per finestra e per IP (default 120)
 *   RATE_LIMIT_WINDOW_MS   durata finestra in ms (default 60000)
 *   TRUST_PROXY            "true" se dietro reverse proxy (IP client da X-Forwarded-For)
 */

import {creaApp} from "./app.js";

const porta = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";

const server = creaApp().listen(porta, host, () => {
    console.log(`[gewiss-configurator] API in ascolto su http://${host}:${porta}`);
});

function arresta(segnale) {
    console.log(`[gewiss-configurator] ${segnale} ricevuto, arresto in corso`);
    server.close(() => process.exit(0));
}

process.on("SIGINT", arresta);
process.on("SIGTERM", arresta);
