export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const studentId = req.query.id || '22609743';
    // Identifiant exact extrait de ta capture d'écran CELCAT UVSQ
    const cidParam = req.query.cid || '-1742253826;1073733534;175432540;108';

    try {
        const now = new Date();
        const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const endDate = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString().split('T')[0];

        const params = new URLSearchParams();
        params.append('start', startDate);
        params.append('end', endDate);
        params.append('resType', '104');
        params.append('calView', 'month');
        params.append('federationIds[]', studentId);
        params.append('colourScheme', '3');

        // Appel direct avec l'URL paramétrée de l'IUT GMP
        const targetUrl = `https://edt.uvsq.fr/cal?vt=month&dt=${startDate}&et=student&cid=${encodeURIComponent(cidParam)}&fid0=${studentId}`;
        
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });

        if (!response.ok) throw new Error(`Erreur HTTP UVSQ: ${response.status}`);

        const htmlText = await response.text();
        const events = parseCelcatHtmlPage(htmlText);

        return res.status(200).json({
            success: true,
            student: "Tounga Nana, Adriel Kynan",
            group: "GMP1S1TP4",
            count: events.length,
            events: events
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message,
            events: []
        });
    }
}

// Extraction propre des blocs d'événements CELCAT
function parseCelcatHtmlPage(html) {
    const events = [];
    
    // Extraction des scripts ou données JSON injectées dans la page par CELCAT
    const jsonMatch = html.match(/events\s*:\s*(\[\s*\{.*?\}\s*\])/s);

    if (jsonMatch && jsonMatch[1]) {
        try {
            const raw = JSON.parse(jsonMatch[1]);
            return raw.map((item, idx) => {
                // Découpage des lignes HTML (<br />) de chaque case de cours
                const lines = (item.title || item.description || '')
                    .split(/<br\s*\/?>|\n/)
                    .map(l => l.replace(/<[^>]*>/g, '').trim())
                    .filter(Boolean);

                return {
                    id: item.id || `evt-${idx}`,
                    // Exemple ligne 1: "GMP1S1TP4 [GMP1S1TP4]" -> Type/Groupe
                    // Ligne 2: "C015 ATELIER" ou "B103 - Mantes" -> Salle
                    // Ligne 3: "MMPR107 Production méthodes" -> Matière
                    // Ligne 4: "Bazin, Bruno / Vallery, Gaël" -> Professeur
                    title: lines[2] || lines[0] || 'Cours GMP',
                    type: extractCourseType(lines),
                    start: item.start,
                    end: item.end,
                    room: lines[1] || 'Salle N/A',
                    prof: lines[lines.length - 1] || 'Enseignant UVSQ',
                    rawDetails: lines
                };
            });
        } catch (e) {
            console.error("Erreur parsing JSON interne CELCAT", e);
        }
    }
    return events;
}

function extractCourseType(lines) {
    const fullText = lines.join(' ');
    if (/\bTP\b/i.test(fullText)) return 'TP';
    if (/\bTD\b/i.test(fullText)) return 'TD';
    if (/\bCM\b/i.test(fullText)) return 'CM';
    return 'TP';
}