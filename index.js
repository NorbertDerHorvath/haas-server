const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// 1. API KULCS BEÁLLÍTÁSA (ezt a Render-en kell megadnod)
const API_KEY = process.env.API_KEY || 'alapertelmezett-titkos-kulcs';

// 2. ADATBÁZIS HELYETT MEMÓRIÁBAN TÁROLÁS (egyszerűség kedvéért)
// A felhasználók adatait itt tároljuk. Az app újraindulásakor ez törlődik.
const users = {};

// Middleware a JSON-formátumú kérések feldolgozásához
app.use(express.json());

// 3. HITelesítési MIDDLEWARE (API-kulcs ellenőrzése)
// Ez a middleware minden kérésnél lefut, és ellenőrzi az API-kulcsot.
const checkApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key']; // Az app ebben a fejlécben fogja küldeni a kulcsot
    if (!apiKey || apiKey !== API_KEY) {
        return res.status(401).send('Unauthorized'); // Ha a kulcs rossz, 401-es hibát küldünk
    }
    next(); // Ha a kulcs jó, a kérés továbbmegy a megfelelő végpontra
};

// A hitelesítési middleware alkalmazása az összes útvonalra
app.use(checkApiKey);


// 4. ÚTVONALAK (VÉGPONTOK)

// GET /users - Az összes felhasználó adatának lekérdezése
app.get('/users', (req, res) => {
    // A users objektumot egy listává (tömbbé) alakítjuk, és azt küldjük vissza
    const userList = Object.values(users);
    console.log(`Lekérdezés: ${userList.length} felhasználó adatainak elküldése.`);
    res.json(userList);
});

// POST /users - Egy felhasználó adatainak frissítése vagy létrehozása
app.post('/users', (req, res) => {
    const userData = req.body;

    // Alapvető validáció: a `userId` kötelező
    if (!userData || !userData.userId) {
        return res.status(400).send('Bad Request: a `userId` hiányzik.');
    }
    
    // A felhasználó adatainak tárolása a `userId` alapján
    users[userData.userId] = {
        ...userData,
        lastUpdated: Date.now() // Hozzáadunk egy időbélyeget a frissítés idejéről
    };
    
    console.log(`Frissítés: ${userData.userId} nevű felhasználó adatai elmentve.`);
    res.status(200).send('Adatok sikeresen frissítve.');
});


// A szerver elindítása
app.listen(PORT, () => {
    console.log(`A szerver fut a http://localhost:${PORT} porton`);
});
