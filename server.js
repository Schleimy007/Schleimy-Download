const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const cheerio = require('cheerio');
const QRCode = require('qrcode');

// --- FIREBASE LITE (Spezial-Version für Vercel) ---
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, getDoc, deleteDoc } = require('firebase/firestore/lite');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// DEINE FIREBASE DATEN 
// ==========================================

const firebaseConfig = {
  apiKey: "AIzaSyDpQIz9cKMm86zZ8jOLLb0TLUFEo9bbbAc",
  authDomain: "phil-downloads-portal.firebaseapp.com",
  projectId: "phil-downloads-portal",
  storageBucket: "phil-downloads-portal.firebasestorage.app",
  messagingSenderId: "595351890044",
  appId: "1:595351890044:web:a426992f3ff6b74348c1f9",
  measurementId: "G-KNJKVCV34P"
};



// Initialisiert Firebase im "Lite" Modus (Perfekt für Vercel)
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// --- 1. SECURE PASTEBIN ---
app.post('/api/paste', async (req, res) => {
    try {
        const { text, password, isBurn } = req.body;
        if (!text) return res.status(400).json({ error: 'Kein Text' });
        
        const id = uuidv4().slice(0, 8);
        const pasteData = {
            text: text,
            password: password || null,
            isBurn: !!isBurn,
            createdAt: Date.now() // Zeitstempel für automatischen Ablauf
        };
        
        // Speichert das Dokument sicher in Firestore
        await setDoc(doc(db, "pastes", id), pasteData);
        
        res.json({ id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: `Vercel DB Fehler beim Speichern: ${error.message}` });
    }
});

app.post('/api/paste/read', async (req, res) => {
    try {
        const { id, password } = req.body;
        const pasteRef = doc(db, "pastes", id);
        const pasteSnap = await getDoc(pasteRef);
        
        if (!pasteSnap.exists()) {
            return res.status(404).json({ error: 'Paste nicht gefunden oder bereits zerstört.' });
        }
        
        const paste = pasteSnap.data();

        // Check: Ist der Paste älter als 7 Tage? (604.800.000 Millisekunden)
        if (Date.now() - paste.createdAt > 604800000) {
            await deleteDoc(pasteRef);
            return res.status(404).json({ error: 'Paste ist nach 7 Tagen abgelaufen und wurde gelöscht.' });
        }
        
        // Passwort Check
        if (paste.password && paste.password !== password) {
            return res.status(403).json({ error: 'Falsches Passwort!' });
        }

        // Burn after reading
        if (paste.isBurn) {
            await deleteDoc(pasteRef);
        }
        
        res.json({ text: paste.text });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: `Vercel DB Fehler beim Lesen: ${error.message}` });
    }
});

// --- 2. URL SHORTENER ---
app.post('/api/shorten', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'Keine URL' });
        
        const id = uuidv4().slice(0, 5);
        
        await setDoc(doc(db, "shortlinks", id), {
            url: url,
            createdAt: Date.now()
        });
        
        res.json({ shortUrl: `/s/${id}` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: `Vercel DB Fehler beim Kürzen: ${error.message}` });
    }
});

app.get('/s/:id', async (req, res) => {
    try {
        const linkRef = doc(db, "shortlinks", req.params.id);
        const linkSnap = await getDoc(linkRef);
        
        if (!linkSnap.exists()) return res.status(404).send('Shortlink existiert nicht.');
        
        const link = linkSnap.data();

        // Links verfallen nach 30 Tagen
        if (Date.now() - link.createdAt > 2592000000) {
            await deleteDoc(linkRef);
            return res.status(404).send('Shortlink ist nach 30 Tagen abgelaufen.');
        }

        res.redirect(link.url);
    } catch (error) {
        console.error(error);
        res.status(500).send('Datenbank Fehler');
    }
});

// --- 3. QR CODE GENERATOR ---
app.get('/api/qr', async (req, res) => {
    const { data } = req.query;
    if (!data) return res.status(400).send('Keine Daten');
    try {
        const qrImage = await QRCode.toDataURL(data);
        res.json({ qr: qrImage });
    } catch (e) {
        res.status(500).json({ error: 'QR Fehler' });
    }
});

// --- 4. SCRIBD TEXT SCRAPER ---
app.get('/api/scribd', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Scribd URL fehlt' });

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                'Referer': 'https://www.google.com/'
            }
        });
        
        const html = await response.text();
        const $ = cheerio.load(html);
        
        const title = $('title').text().replace(' - Scribd', '').trim();
        let extractedText = "";
        
        $('.text_line, span.a, p, .document_scroller span').each((i, el) => {
            const line = $(el).text().trim();
            if (line) extractedText += line + "\n";
        });

        if(extractedText.length < 100) {
            extractedText = "Scribd hat den Text hart als Bilddatei verschlüsselt.\n\nKurzbeschreibung:\n" + $('meta[name="description"]').attr('content');
        }

        res.json({ title, text: extractedText });
    } catch (error) {
        res.status(500).json({ error: 'Scraping fehlgeschlagen' });
    }
});

// --- WICHTIG FÜR VERCEL ---
module.exports = app;