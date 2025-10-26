// 1. A szükséges csomagok betöltése
const express = require('express');
const { Pool } = require('pg');
const basicAuth = require('basic-auth');
const path = require('path');

// 2. Az Express alkalmazás és a port beállítása
const app = express();
const PORT = process.env.PORT || 3000;

// 3. Adatbázis kapcsolat létrehozása
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

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
    const ADMIN_USER = process.env.ADMIN_USER || 'admin';
    const ADMIN_PASS = process.env.ADMIN_PASS || 'password';
    const credentials = basicAuth(req);
    if (!credentials || credentials.name !== ADMIN_USER || credentials.pass !== ADMIN_PASS) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Simple Dashboard"');
        return res.status(401).send('Hozzáférés megtagadva');
    }
    next();
};


// 5. API VÉGPONTOK

// --- NEM VÉDETT VÉGPONTOK (az Android app számára) ---
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
        for (const event of events) {
            const params = [event.deviceId, event.driverName, event.eventType, event.timestamp, event.latitude, event.longitude, event.address];
            await pool.query(insertSql, params);
        }
        console.log(`Sikeresen elmentve ${events.length} esemény.`);
        res.status(200).send({ message: 'Adatfeldolgozás elindítva' });
    } catch (err) {
        console.error("Hiba az adatbázisba íráskor:", err);
        res.status(500).send({ message: 'Szerverhiba az adatbázisba íráskor.' });
    }
});


// --- MINDEN EZ ALATT MÁR JELSZÓVAL VÉDETT ---
app.use(checkAuth);

// Statikus fájlok kiszolgálása a 'public' mappából
app.use(express.static(path.join(__dirname, 'public')));

// --- VÉDETT API VÉGPONTOK (a böngésző számára) ---
app.get('/api/drivers', async (req, res) => {
    const sql = "SELECT DISTINCT driverName FROM events WHERE driverName IS NOT NULL";
    try {
        const result = await pool.query(sql);
        const drivers = result.rows.map(r => r.drivername); // Figyelem: a pg kisbetűssé teheti
        res.status(200).json(drivers);
    } catch (err) {
        console.error("Hiba a sofőrök lekérdezésekor:", err);
        res.status(500).send({ message: 'Szerverhiba a sofőrök lekérdezésekor.' });
    }
});

app.get('/api/work-sessions', async (req, res) => {
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
            if (!sessions[event.deviceid]) { // Figyelem: a pg kisbetűssé teheti
                sessions[event.deviceid] = { lastArrival: null };
            }
            if (event.eventtype === 'ARRIVAL') { // Figyelem: a pg kisbetűssé teheti
                sessions[event.deviceid].lastArrival = event;
            } else if (event.eventtype === 'DEPARTURE' && sessions[event.deviceid].lastArrival) {
                const arrival = sessions[event.deviceid].lastArrival;
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
                sessions[event.deviceid].lastArrival = null;
            }
        });
        completedWorks.sort((a, b) => b.arrivalTime - a.arrivalTime);
        res.status(200).json(completedWorks);
    } catch (err) {
        console.error("Hiba az adatok lekérdezésekor:", err);
        res.status(500).send({ message: 'Szerverhiba az adatok lekérdezésekor.' });
    }
});

// --- BIZTONSÁGI HÁLÓ: Ha semmi más nem illeszkedik, küldjük az index.html-t ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// 6. A szerver elindítása
app.listen(PORT, () => {
    console.log(`A szerver fut a http://localhost:${PORT} címen`);
});