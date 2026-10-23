export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const studentId = req.query.id || '22609743';

    try {
        // 1. Définir la plage de dates (du début du mois actuel à la fin du mois suivant)
        const now = new Date();
        const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const endDate = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString().split('T')[0];

        // 2. Préparer les paramètres exacts attendus par CELCAT Web Publisher
        const params = new URLSearchParams();
        params.append('start', startDate);
        params.append('end', endDate);
        params.append('resType', '104'); // Type étu/groupe UVSQ
        params.append('calView', 'month');
        params.append('federationIds[]', studentId);
        params.append('colourScheme', '3');

        // 3. Effectuer le scraping direct de l'endpoint d'événements CELCAT
        const response = await fetch('https://edt.uvsq.fr/Home/GetCalendarData', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: params.toString()
        });

        if (!response.ok) {
            // Repli sur la page principale si l'endpoint JSON direct requiert une session
            const fallbackResponse = await fetch(`https://edt.uvsq.fr/cal?vt=month&et=student&fid0=${studentId}`);
            const htmlText = await fallbackResponse.text();
            const events = parseHtmlFallback(htmlText);
            
            return res.status(200).json({ success: true, source: 'html_fallback', events });
        }

        const rawData = await response.json();
        
        // 4. Nettoyer et structurer les données reçues
        const cleanEvents = (Array.isArray(rawData) ? rawData : []).map((evt, idx) => {
            const descriptionParts = (evt.description || evt.title || '')
                .split('<br />')
                .map(s => s.replace(/<[^>]*>/g, '').trim())
                .filter(Boolean);

            return {
                id: evt.id || `evt-${idx}`,
                title: evt.title ? evt.title.split('\n')[0] : (descriptionParts[0] || 'Cours'),
                type: extractType(evt.title || evt.description || ''),
                start: evt.start,
                end: evt.end,
                room: extractRoom(descriptionParts),
                prof: extractProf(descriptionParts)
            };
        });

        return res.status(200).json({
            success: true,
            count: cleanEvents.length,
            events: cleanEvents
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message,
            events: []
        });
    }
}

// Utilitaires d'extraction de texte
function extractType(text) {
    if (/TP/i.test(text)) return 'TP';
    if (/TD/i.test(text)) return 'TD';
    if (/CM/i.test(text)) return 'CM';
    return 'TD';
}

function extractRoom(parts) {
    const room = parts.find(p => /salle|amphi|labo|atelier|b\d+/i.test(p));
    return room || (parts.length > 1 ? parts[1] : 'Salle N/A');
}

function extractProf(parts) {
    const prof = parts.find(p => /M\.|MME|PROF/i.test(p));
    return prof || (parts.length > 2 ? parts[2] : 'UVSQ');
}

function parseHtmlFallback(html) {
    // Analyse de secours
    return [];
}