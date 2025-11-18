const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. API KULCS BEÁLLÍTÁSA
const API_KEY = process.env.API_KEY || 'alapertelmezett-titkos-kulcs';

// 2. ADATBÁZIS CSATLAKOZÁS BEÁLLÍTÁSA
// A kapcsolódási adatokat a Render-en beállított DATABASE_URL környezeti változóból veszi.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Szükséges a Render-en a sikeres csatlakozáshoz
    }
});

// Middleware a JSON-formátumú kérések feldolgozásához
app.use(express.json());

// 3. HITelesítési MIDDLEWARE
const checkApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== API_KEY) {
        return res.status(401).send('Unauthorized');
    }
    next();
};
app.use(checkApiKey);


// 4. ADATBÁZIS TÁBLA LÉTREHOZÁSA (ha még nem létezik)
const createUsersTable = async () => {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS users (
            "userId" VARCHAR(255) PRIMARY KEY,
            "latitude" DOUBLE PRECISION,
            "longitude" DOUBLE PRECISION,
            "address" TEXT,
            "batteryLevel" REAL,
            "isCharging" BOOLEAN,
            "lastUpdated" BIGINT
        );
    `;
    try {
        await pool.query(createTableQuery);
        console.log('"users" tábla sikeresen ellenőrizve/létrehozva.');
    } catch (err) {
        console.error('Hiba a "users" tábla létrehozásakor:', err);
        // Leállítjuk a szervert, ha az adatbázis alapvető művelet hibára fut.
        process.exit(1); 
    }
};


// 5. ÚTVONALAK (VÉGPONTOK)

// GET /users - Az összes felhasználó adatának lekérdezése az adatbázisból
app.get('/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM users');
        console.log(`Lekérdezés: ${result.rows.length} felhasználó adatainak elküldése az adatbázisból.`);
        res.json(result.rows);
    } catch (err) {
        console.error('Hiba a felhasználók lekérdezésekor:', err);
        res.status(500).send('Server error');
    }
});

// POST /users - Egy felhasználó adatainak frissítése vagy létrehozása az adatbázisban (UPSERT)
app.post('/users', async (req, res) => {
    const userData = req.body;

    if (!userData || !userData.userId) {
        return res.status(400).send('Bad Request: a `userId` hiányzik.');
    }

    const { userId, latitude, longitude, address, batteryLevel, isCharging } = userData;
    const lastUpdated = Date.now();

    const upsertQuery = `
        INSERT INTO users ("userId", "latitude", "longitude", "address", "batteryLevel", "isCharging", "lastUpdated")
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT ("userId") DO UPDATE SET
            "latitude" = EXCLUDED.latitude,
            "longitude" = EXCLUDED.longitude,
            "address" = EXCLUDED.address,
            "batteryLevel" = EXCLUDED.batteryLevel,
            "isCharging" = EXCLUDED.isCharging,
            "lastUpdated" = EXCLUDED.lastUpdated;
    `;

    try {
        await pool.query(upsertQuery, [userId, latitude, longitude, address, batteryLevel, isCharging, lastUpdated]);
        console.log(`Frissítés: ${userId} nevű felhasználó adatai elmentve az adatbázisba.`);
        res.status(200).send('Adatok sikeresen frissítve.');
    } catch (err) {
        console.error('Hiba az adatbázisba íráskor:', err);
        res.status(500).send('Server error');
    }
});


// A szerver elindítása és az adatbázis tábla ellenőrzése
app.listen(PORT, async () => {
    console.log(`A szerver fut a http://localhost:${PORT} porton`);
    await createUsersTable();
});