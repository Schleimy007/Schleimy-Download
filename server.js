const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const cheerio = require('cheerio');
const QRCode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// FIREBASE REST API (100% Vercel-kompatibel)
// ==========================================
const PROJECT_ID = "schleimy-download-portal";
const API_KEY = "AIzaSyChyWkhBMP6kbAvkiHFJ36G_faHRI7Mbpg";
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// --- 1. SECURE PASTEBIN ---
app.post('/api/paste', async (req, res) => {
    try {
        const { text, password, isBurn } = req.body;
        if (!text) return res.status(400).json({ error: 'Kein Text' });
        
        const id = uuidv4().slice(0, 8);
        
        const payload = {
            fields: {
                text: { stringValue: text },
                password: { stringValue: password || "" },
                isBurn: { booleanValue: !!isBurn },
                createdAt: { integerValue: Date.now().toString() }
            }
        };
        
        const response = await fetch(`${BASE_URL}/pastes?documentId=${id}&key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        
        // DIE MASKE IST WEG: Wir senden den ECHTEN Google-Fehler ans Frontend!
        if (data.error) {
            return res.status(500).json({ error: `Google sagt: ${data.error.message} (Code: ${data.error.code})` });
        }
        
        res.json({ id });
    } catch (error) {
        res.status(500).json({ error: `Server Crash beim Speichern: ${error.message}` });
    }
});

app.post('/api/paste/read', async (req, res) => {
    try {
        const { id, password } = req.body;
        
        const response = await fetch(`${BASE_URL}/pastes/${id}?key=${API_KEY}`);
        const data = await response.json();
        
        if (data.error) {
            if (data.error.code === 404) return res.status(404).json({ error: 'Paste nicht gefunden oder bereits zerstört.' });
            return res.status(500).json({ error: `Google sagt beim Lesen: ${data.error.message}` });
        }
        
        const paste = data.fields;
        const createdAt = parseInt(paste.createdAt.integerValue);
        const isBurn = paste.isBurn.booleanValue;
        const dbPassword = paste.password.stringValue;
        const text = paste.text.stringValue;

        if (Date.now() - createdAt > 604800000) {
            await fetch(`${BASE_URL}/pastes/${id}?key=${API_KEY}`, { method: 'DELETE' });
            return res.status(404).json({ error: 'Paste ist nach 7 Tagen abgelaufen und wurde gelöscht.' });
        }
        
        if (dbPassword && dbPassword !== password) return res.status(403).json({ error: 'Falsches Passwort!' });

        if (isBurn) {
            await fetch(`${BASE_URL}/pastes/${id}?key=${API_KEY}`, { method: 'DELETE' });
        }
        
        res.json({ text: text });
    } catch (error) {
        res.status(500).json({ error: `Server Crash beim Lesen: ${error.message}` });
    }
});

// --- 2. URL SHORTENER ---
app.post('/api/shorten', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'Keine URL' });
        
        const id = uuidv4().slice(0, 5);
        const payload = {
            fields: {
                url: { stringValue: url },
                createdAt: { integerValue: Date.now().toString() }
            }
        };
        
        const response = await fetch(`${BASE_URL}/shortlinks?documentId=${id}&key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (data.error) return res.status(500).json({ error: `Google Link-Fehler: ${data.error.message}` });
        
        res.json({ shortUrl: `/s/${id}` });
    } catch (error) {
        res.status(500).json({ error: `Server Crash Link-Kürzen: ${error.message}` });
    }
});

app.get('/s/:id', async (req, res) => {
    try {
        const response = await fetch(`${BASE_URL}/shortlinks/${req.params.id}?key=${API_KEY}`);
        const data = await response.json();
        
        if (data.error && data.error.code === 404) return res.status(404).send('Shortlink existiert nicht.');
        
        const url = data.fields.url.stringValue;
        const createdAt = parseInt(data.fields.createdAt.integerValue);

        if (Date.now() - createdAt > 2592000000) {
            await fetch(`${BASE_URL}/shortlinks/${req.params.id}?key=${API_KEY}`, { method: 'DELETE' });
            return res.status(404).send('Shortlink ist nach 30 Tagen abgelaufen.');
        }

        res.redirect(url);
    } catch (error) {
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

// --- VERCEL EXPORT ---
module.exports = app;