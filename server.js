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

// --- DATENBANKEN (In-Memory) ---
const pastes = {};
const shortLinks = {};

// --- 1. PASTEBIN ---
app.post('/api/paste', (req, res) => {
    const { text, password, isBurn } = req.body;
    if (!text) return res.status(400).json({ error: 'Kein Text' });
    const id = uuidv4().slice(0, 8);
    pastes[id] = { text, password: password || null, isBurn: !!isBurn };
    res.json({ id });
});

app.post('/api/paste/read', (req, res) => {
    const { id, password } = req.body;
    const paste = pastes[id];
    
    if (!paste) return res.status(404).json({ error: 'Paste nicht gefunden' });
    if (paste.password && paste.password !== password) return res.status(403).json({ error: 'Falsches Passwort' });

    const text = paste.text;
    if (paste.isBurn) delete pastes[id]; 
    
    res.json({ text });
});

// --- 2. URL SHORTENER ---
app.post('/api/shorten', (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Keine URL' });
    const id = uuidv4().slice(0, 5);
    shortLinks[id] = url;
    res.json({ shortUrl: `/s/${id}` });
});

app.get('/s/:id', (req, res) => {
    const url = shortLinks[req.params.id];
    if (url) res.redirect(url);
    else res.status(404).send('Shortlink nicht gefunden');
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

// --- 4. MEDIA DOWNLOADER ---
// Entfernt! Läuft jetzt zu 100% über den Browser des Nutzers (Frontend).

// --- 5. SCRIBD TEXT SCRAPER ---
app.get('/api/scribd', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Scribd URL fehlt' });

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                'Referer': 'https://www.google.com/',
                'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7'
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[SCHLEIMY'S OMNITOOL] Server läuft auf Port ${PORT}`);
});