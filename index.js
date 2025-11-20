const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. API KULCS BEÁLLÍTÁSA
const API_KEY = process.env.API_KEY || 'alapertelmezett-titkos-kulcs';

// 2. ADATBÁZIS CSATLAKOZÁS BEÁLLÍTÁSA
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Middleware a JSON-formátumú kérések feldolgozásához
app.use(express.json());

// 3. HITELESÍTÉSI MIDDLEWARE
const checkApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== API_KEY) {
        return res.status(401).send('Unauthorized');
    }
    next();
};
app.use(checkApiKey);

// 4. ADATBÁZIS TÁBLA LÉTREHOZÁSÁNAK FÜGGVÉNYE
const initializeDatabase = async () => {
    // Az oszlopneveket idézőjelbe tesszük, hogy a PostgreSQL megőrizze a camelCase formát
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS users (
            "userId" VARCHAR(255) PRIMARY KEY,
            "latitude" DOUBLE PRECISION,
            "longitude" DOUBLE PRECISION,
            "address" TEXT,
            "batteryLevel" REAL,
            "isCharging" BOOLEAN,
            "speed" REAL,
            "pluggedIn" TEXT,
            "callLog" JSONB,
            "lastUpdated" BIGINT
        );
    `;
    try {
        await pool.query('DROP TABLE IF EXISTS users;');
        console.log('"users" tábla sikeresen törölve (ha létezett).');
        
        await pool.query(createTableQuery);
        console.log('"users" tábla sikeresen létrehozva.');
    } catch (err) {
        console.error('Hiba az adatbázis inicializálásakor:', err);
        process.exit(1); 
    }
};

// 5. ÚTVONALAK (VÉGPONTOK)

// GET /users
app.get('/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT "userId", "latitude", "longitude", "address", "batteryLevel", "isCharging", "speed", "pluggedIn", "callLog", "lastUpdated" FROM users');
        console.log(`Lekérdezés: ${result.rows.length} felhasználó adatainak elküldése.`);
        res.json(result.rows);
    } catch (err) {
        console.error('Hiba a felhasználók lekérdezésekor:', err);
        res.status(500).send('Server error');
    }
});

// POST /users
app.post('/users', async (req, res) => {
    const userData = req.body;

    if (!userData || !userData.userId) {
        return res.status(400).send('Bad Request: a `userId` hiányzik.');
    }

    const { userId, latitude, longitude, address, batteryLevel, isCharging, speed, pluggedIn, callLog } = userData;
    const lastUpdated = Date.now();
    const callLogInJson = callLog ? JSON.stringify(callLog) : null;

    // JAVÍTVA: Az ON CONFLICT részben is idézőjellel használjuk az oszlopneveket
    const upsertQuery = `
        INSERT INTO users ("userId", "latitude", "longitude", "address", "batteryLevel", "isCharging", "speed", "pluggedIn", "callLog", "lastUpdated")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT ("userId") DO UPDATE SET
            "latitude" = EXCLUDED."latitude",
            "longitude" = EXCLUDED."longitude",
            "address" = EXCLUDED."address",
            "batteryLevel" = EXCLUDED."batteryLevel",
            "isCharging" = EXCLUDED."isCharging",
            "speed" = EXCLUDED."speed",
            "pluggedIn" = EXCLUDED."pluggedIn",
            "callLog" = EXCLUDED."callLog",
            "lastUpdated" = EXCLUDED."lastUpdated";
    `;

    try {
        await pool.query(upsertQuery, [userId, latitude, longitude, address, batteryLevel, isCharging, speed, pluggedIn, callLogInJson, lastUpdated]);
        res.status(200).send('Adatok sikeresen frissítve.');
    } catch (err) {
        console.error('Hiba az adatbázisba íráskor:', err);
        res.status(500).send('Server error');
    }
});

// A szerver elindítása és az adatbázis inicializálása
app.listen(PORT, async () => {
    console.log(`A szerver fut a http://localhost:${PORT} porton`);
    await initializeDatabase();
});