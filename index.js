// 1. A szükséges csomagok betöltése
const express = require('express');
const { Pool } = require('pg'); // SQLite helyett PostgreSQL
const basicAuth = require('basic-auth'); // Jelszavas védelemhez

// 2. Az Express alkalmazás és a port beállítása
const app = express();
// A Render.com a PORT környezeti változóból olvassa ki a portot
const PORT = process.env.PORT || 3000; 

// 3. Adatbázis kapcsolat létrehozása
// A Pool a kapcsolati adatokat a DATABASE_URL környezeti változóból fogja venni,
// amit a Render automatikusan beállít.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Szükséges a Render-en a csatlakozáshoz
    }
});

// Adatbázis tábla létrehozása, ha még nem létezik
const createTable = async () => {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS events (
            id SERIAL PRIMARY KEY,
            deviceId TEXT NOT NULL,
            driverName TEXT,
            eventType TEXT NOT NULL,
            timestamp BIGINT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            address TEXT
        );`;
    try {
        await pool.query(createTableQuery);
        console.log("Az 'events' tábla készen áll.");
    } catch (err) {
        console.error("Hiba az 'events' tábla létrehozásakor:", err);
    }
};
createTable();


// 4. Middleware beállítások
app.use(express.json());

// Jelszavas védelem middleware
const checkAuth = (req, res, next) => {
    // A felhasználónevet és jelszót a környezeti változókból olvassuk
    const ADMIN_USER = process.env.ADMIN_USER || 'admin';
    const ADMIN_PASS = process.env.ADMIN_PASS || 'password';

    const credentials = basicAuth(req);

    if (!credentials || credentials.name !== ADMIN_USER || credentials.pass !== ADMIN_PASS) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Simple Dashboard"');
        return res.status(401).send('Hozzáférés megtagadva');
    }
    // Ha a jelszó helyes, továbbengedjük a kérést
    next();
};

// A statikus fájlokat (public mappa) nem védjük le, de az API-t igen
app.use(express.static('public'));


// 5. API VÉGPONTOK (mindegyik a jelszavas védelem mögött)

app.post('/api/ping', (req, res) => {
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).send({ message: 'Hiányzó deviceId.' });
    console.log(`---> BEJELENTKEZÉS: ${deviceId} <---`);
    res.status(200).send({ message: 'Ping fogadva' });
});

app.post('/api/events', async (req, res) => {
    const events = req.body;
    if (!events || !Array.isArray(events)) return res.status(400).send({ message: 'Érvénytelen adatformátum.' });

    const insertSql = `INSERT INTO events (deviceId, driverName, eventType, timestamp, latitude, longitude, address) VALUES ($1, $2, $3, $4, $5, $6, $7)`;
    
    try {
        // A forEach nem működik jól async operációkkal, ezért for...of ciklust használunk
        for (const event of events) {
            const params = [event.deviceId, event.driverName, event.eventType, event.timestamp, event.latitude, event.longitude, event.address];
            await pool.query(insertSql, params);
            console.log(`Sikeresen elmentve egy új esemény.`);
        }
        res.status(200).send({ message: 'Adatfeldolgozás elindítva' });
    } catch (err) {
        console.error("Hiba az adatbázisba íráskor:", err);
        res.status(500).send({ message: 'Szerverhiba az adatbázisba íráskor.' });
    }
});

app.get('/api/drivers', checkAuth, async (req, res) => {
    const sql = "SELECT DISTINCT driverName FROM events WHERE driverName IS NOT NULL";
    try {
        const result = await pool.query(sql);
        const drivers = result.rows.map(r => r.driverName);
        res.status(200).json(drivers);
    } catch (err) {
        console.error("Hiba a sofőrök lekérdezésekor:", err);
        res.status(500).send({ message: 'Szerverhiba a sofőrök lekérdezésekor.' });
    }
});

app.get('/api/work-sessions', checkAuth, async (req, res) => {
    const { driver, startDate, endDate } = req.query;

    let sql = "SELECT * FROM events";
    const params = [];
    const conditions = [];
    let paramIndex = 1;

    if (driver) {
        conditions.push(`driverName = $${paramIndex++}`);
        params.push(driver);
    }
    if (startDate) {
        conditions.push(`timestamp >= $${paramIndex++}`);
        params.push(new Date(startDate).getTime());
    }
    if (endDate) {
        conditions.push(`timestamp <= $${paramIndex++}`);
        params.push(new Date(endDate).setHours(23, 59, 59, 999));
    }

    if (conditions.length > 0) {
        sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY deviceId, timestamp";

    try {
        const result = await pool.query(sql, params);
        const rows = result.rows;
        
        const sessions = {};
        const completedWorks = [];

        rows.forEach(event => {
            if (!sessions[event.deviceId]) {
                sessions[event.deviceId] = { lastArrival: null };
            }

            if (event.eventType === 'ARRIVAL') {
                sessions[event.deviceId].lastArrival = event;
            } else if (event.eventType === 'DEPARTURE' && sessions[event.deviceId].lastArrival) {
                const arrival = sessions[event.deviceId].lastArrival;
                const departure = event;

                if (departure.timestamp > arrival.timestamp) {
                    const durationMs = departure.timestamp - arrival.timestamp;
                    const durationMinutes = Math.round(durationMs / 60000);

                    completedWorks.push({
                        driverName: arrival.drivername || 'Ismeretlen',
                        arrivalTime: arrival.timestamp,
                        departureTime: departure.timestamp,
                        duration: `${durationMinutes} perc`,
                        address: arrival.address || 'N/A'
                    });
                }
                sessions[event.deviceId].lastArrival = null;
            }
        });

        completedWorks.sort((a, b) => b.arrivalTime - a.arrivalTime);
        res.status(200).json(completedWorks);

    } catch (err) {
        console.error("Hiba az adatok lekérdezésekor:", err);
        res.status(500).send({ message: 'Szerverhiba az adatok lekérdezésekor.' });
    }
});

// 6. A szerver elindítása
app.listen(PORT, () => {
    console.log(`A szerver fut a http://localhost:${PORT} címen`);
});