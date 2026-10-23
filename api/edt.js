export default async function handler(req, res) {
    // Autoriser les requêtes CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const studentId = req.query.id || '22609743';
    const targetUrl = `https://edt.uvsq.fr/cal?vt=month&et=student&fid0=${studentId}`;

    try {
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`Erreur HTTP UVSQ: ${response.status}`);
        }

        const htmlText = await response.text();
        
        // Extraction des événements depuis le HTML CELCAT
        const parsedEvents = extractCelcatEvents(htmlText);

        res.status(200).json({
            success: true,
            count: parsedEvents.length,
            events: parsedEvents
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            events: []
        });
    }
}

// Fonction de parsing HTML CELCAT
function extractCelcatEvents(html) {
    const events = [];
    
    // CELCAT intègre souvent les événements sous forme de blocs JSON ou d'objets JavaScript dans le HTML
    const jsonMatch = html.match(/events\s*:\s*(\[\s*\{.*?\}\s*\])/s);

    if (jsonMatch && jsonMatch[1]) {
        try {
            const rawEvents = JSON.parse(jsonMatch[1]);
            return rawEvents.map((e, index) => {
                const titleParts = (e.title || '').split('\n').map(s => s.trim()).filter(Boolean);
                
                return {
                    id: e.id || `evt-${index}`,
                    title: titleParts[0] || 'Cours UVSQ',
                    type: detectCourseType(e.title || ''),
                    start: e.start,
                    end: e.end,
                    room: extractRoom(titleParts) || 'Voir ENT',
                    prof: extractProf(titleParts) || 'UVSQ'
                };
            });
        } catch (err) {
            console.error("Erreur de lecture du JSON interne CELCAT:", err);
        }
    }

    return events;
}

function detectCourseType(text) {
    if (text.includes('TP')) return 'TP';
    if (text.includes('TD')) return 'TD';
    if (text.includes('CM')) return 'CM';
    return 'TD';
}

function extractRoom(parts) {
    const roomPart = parts.find(p => p.toLowerCase().includes('salle') || p.toLowerCase().includes('amphi') || p.toLowerCase().includes('labo') || p.toLowerCase().includes('atelier'));
    return roomPart || (parts.length > 1 ? parts[1] : null);
}

function extractProf(parts) {
    const profPart = parts.find(p => p.toUpperCase().startsWith('M.') || p.toUpperCase().startsWith('MME') || p.includes(' '));
    return profPart || (parts.length > 2 ? parts[2] : null);
}