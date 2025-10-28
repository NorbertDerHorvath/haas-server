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

// Adatbázis séma frissítése és táblák létrehozása
const setupDatabase = async () => {
    const client = await pool.connect();
    try {
        // 'events' tábla
        await client.query(`
            CREATE TABLE IF NOT EXISTS events (
                id SERIAL PRIMARY KEY,
                deviceId TEXT NOT NULL,
                driverName TEXT,
                eventType TEXT NOT NULL,
                timestamp BIGINT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                address TEXT,
                customer_name TEXT
            );
        `);
        console.log("Az 'events' tábla készen áll.");

        // ÚJ: 'live_locations' tábla
        await client.query(`
            CREATE TABLE IF NOT EXISTS live_locations (
                driverName TEXT PRIMARY KEY,
                address TEXT,
                latitude REAL,
                longitude REAL,
                last_updated BIGINT
            );
        `);
        console.log("Az 'live_locations' tábla készen áll.");

    } catch (err) {
        console.error("Hiba az adatbázis beállításakor:", err);
    } finally {
        client.release();
    }
};
setupDatabase();


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

// 5. ÚTVONALAK (ROUTES)

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

// ÚJ: Élő helyzet frissítése
app.post('/api/live-update', async (req, res) => {
    const { driverName, address, latitude, longitude } = req.body;
    if (!driverName || !address) {
        return res.status(400).send({ message: 'Hiányzó adatok.' });
    }

    const upsertSql = `
        INSERT INTO live_locations (driverName, address, latitude, longitude, last_updated)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (driverName) 
        DO UPDATE SET 
            address = EXCLUDED.address, 
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            last_updated = EXCLUDED.last_updated;
    `;
    try {
        await pool.query(upsertSql, [driverName, address, latitude, longitude, Date.now()]);
        res.status(200).send({ message: 'Élő helyzet frissítve.' });
    } catch (err) {
        console.error("Hiba az élő helyzet frissítésekor:", err);
        res.status(500).send({ message: 'Szerverhiba az élő helyzet frissítésekor.' });
    }
});


// --- VÉDETT API VÉGPONTOK (a böngésző számára) ---
app.get('/api/drivers', checkAuth, async (req, res) => {
    const sql = "SELECT DISTINCT driverName FROM events WHERE driverName IS NOT NULL";
    try {
        const result = await pool.query(sql);
        const drivers = result.rows.map(r => r.drivername);
        res.status(200).json(drivers);
    } catch (err) {
        console.error("Hiba a sofőrök lekérdezésekor:", err);
        res.status(500).send({ message: 'Szerverhiba a sofőrök lekérdezésekor.' });
    }
});

// ÚJ: Élő helyzetek lekérdezése
app.get('/api/live-locations', checkAuth, async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM live_locations ORDER BY driverName");
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Hiba az élő helyzetek lekérdezésekor:", err);
        res.status(500).send({ message: 'Szerverhiba az élő helyzetek lekérdezésekor.' });
    }
});

app.post('/api/customer', checkAuth, async (req, res) => {
    const { sessionId, customerName } = req.body;
    if (!sessionId) {
        return res.status(400).send({ message: 'Hiányzó session ID.' });
    }
    const sql = `UPDATE events SET customer_name = $1 WHERE id = $2`;
    try {
        await pool.query(sql, [customerName, sessionId]);
        res.status(200).send({ message: 'Ügyfél sikeresen mentve.' });
    } catch (err) {
        console.error("Hiba az ügyfél mentésekor:", err);
        res.status(500).send({ message: 'Szerverhiba az ügyfél mentésekor.' });
    }
});

app.get('/api/work-sessions', checkAuth, async (req, res) => {
    const { driver, startDate, endDate, address } = req.query;
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
    if (address) {
        conditions.push(`address ILIKE $${paramIndex++}`);
        params.push(`%${address}%`);
    }

    if (conditions.length > 0) {
        sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY deviceId, timestamp";

    try {
        const result = await pool.query(sql, params);
        const rows = result.rows;

        const initialSessions = [];
        const sessionsByDevice = {};
        rows.forEach(event => {
            const deviceId = event.deviceid;
            if (!sessionsByDevice[deviceId]) {
                sessionsByDevice[deviceId] = { lastArrival: null };
            }
            if (event.eventtype === 'ARRIVAL') {
                sessionsByDevice[deviceId].lastArrival = event;
            } else if (event.eventtype === 'DEPARTURE' && sessionsByDevice[deviceId].lastArrival) {
                const arrival = sessionsByDevice[deviceId].lastArrival;
                if (event.timestamp > arrival.timestamp) {
                    initialSessions.push({
                        sessionId: arrival.id,
                        driverName: arrival.drivername || 'Ismeretlen',
                        arrivalTime: arrival.timestamp,
                        departureTime: event.timestamp,
                        address: arrival.address || 'N/A',
                        customerName: arrival.customer_name || ''
                    });
                }
                sessionsByDevice[deviceId].lastArrival = null;
            }
        });

        const MINUTE_IN_MS = 60 * 1000;
        const sessionsByDriver = {};
        initialSessions.forEach(session => {
            if (!sessionsByDriver[session.driverName]) {
                sessionsByDriver[session.driverName] = [];
            }
            sessionsByDriver[session.driverName].push(session);
        });

        let finalMergedWorks = [];
        for (const driverName in sessionsByDriver) {
            const driverSessions = sessionsByDriver[driverName].sort((a, b) => a.arrivalTime - b.arrivalTime);
            if (driverSessions.length === 0) continue;

            let merged = [];
            let currentSession = { ...driverSessions[0] };

            for (let i = 1; i < driverSessions.length; i++) {
                const nextSession = driverSessions[i];
                const gap = nextSession.arrivalTime - currentSession.departureTime;

                if (gap < MINUTE_IN_MS) {
                    currentSession.departureTime = nextSession.departureTime;
                } else {
                    merged.push(currentSession);
                    currentSession = { ...nextSession };
                }
            }
            merged.push(currentSession);
            finalMergedWorks = finalMergedWorks.concat(merged);
        }

        const formattedWorks = finalMergedWorks.map(session => {
            const durationMs = session.departureTime - session.arrivalTime;
            const durationMinutes = Math.round(durationMs / 60000);
            return {
                ...session,
                duration: `${durationMinutes} Minuten`
            };
        });

        formattedWorks.sort((a, b) => b.arrivalTime - a.arrivalTime);
        res.status(200).json(formattedWorks);

    } catch (err) {
        console.error("Hiba az adatok lekérdezésekor:", err);
        res.status(500).send({ message: 'Szerverhiba az adatok lekérdezésekor.' });
    }
});


// --- STATIKUS FÁJLOK KISZOLGÁLÁSA (a legvégén) ---
app.use(express.static(path.join(__dirname, 'public')));

// 6. A szerver elindítása
app.listen(PORT, () => {
    console.log(`A szerver fut a http://localhost:${PORT} címen`);
});
