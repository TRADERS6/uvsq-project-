/**
 * UVSQ EDT — Widget iOS via Scriptable.
 * Affichage : prochain cours (compte à rebours / en cours) + séances du jour.
 * Configuration OBLIGATOIRE ci-dessous : URL de l'app déployée, n° étudiant,
 * identifiant ENT et mot de passe (identiques à ceux de la PWA).
 */

// ⬇️ À COMPLÉTER PAR L'ÉTUDIANT
const APP_URL = 'https://EDT-VOTRE-DOMAINE.vercel.app'; // sans slash final
const STUDENT_ID = '22609743';                          // numéro étudiant (fid0)
const CID = '-1742253826;1073733534;175432540;108';     // valeur par défaut, fonctionne pour tous
const ENT_LOGIN = '22609743';                           // identifiant ENT
const ENT_PASSWORD = 'VOTRE_MOT_DE_PASSE';              // mot de passe ENT

async function fetchData() {
    const url = `${APP_URL}/api/edt?widget=1&id=${encodeURIComponent(STUDENT_ID)}&cid=${encodeURIComponent(CID)}`;
    const req = new Request(url);
    req.headers = {
        'x-celcat-user': ENT_LOGIN,
        'x-celcat-pass': ENT_PASSWORD
    };
    const res = await req.loadJSON();
    return res;
}

function minutesUntil(iso) {
    return Math.round((new Date(iso) - new Date()) / 60000);
}

function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

async function buildWidget(data) {
    const w = new ListWidget();
    w.backgroundImage = drawBackground();

    if (!data || !data.success || !data.next) {
        const line = w.addText(data && data.success ? 'Rien à venir 🎉' : 'Synchronisation impossible');
        line.font = Font.semiboldSystemFont(14);
        line.textColor = '#94a3b8';
        return w;
    }

    const upcoming = data.next;
    const live = new Date(upcoming.start) <= new Date() && new Date(upcoming.end) >= new Date();

    // Ligne 1 : statuts
    const badge = w.addText(
        live ? `En cours · fin ${fmtTime(upcoming.end)}` : (minutesUntil(upcoming.start) < 60 ? `Dans ${minutesUntil(upcoming.start)} min` : fmtDate(upcoming.start))
    );
    badge.font = Font.boldSystemFont(11);
    badge.textColor = '#60a5fa'; // brand-400

    // Ligne 2 : le titre du cours
    const title = w.addText(upcoming.title);
    title.font = Font.boldSystemFont(15);
    title.textColor = '#ffffff';
    title.maximumNumberOfLines = 2;

    w.addSpacer(4);

    // Ligne 3 : salle + type + prof
    const meta = w.addText(`${upcoming.type} · ${upcoming.room || '--'} · ${upcoming.prof || '--'}`);
    meta.font = Font.regularSystemFont(11);
    meta.textColor = '#94a3b8';
    meta.maximumNumberOfLines = 1;

    // Journée (nombre de séances restant aujourd'hui)
    w.addSpacer();
    const todayCount = data.today ? data.today.length : 0;
    const footer = w.addText(todayCount > 1 ? `${todayCount} séances aujourd'hui` : 'UVSQ EDT');
    footer.font = Font.regularSystemFont(10);
    footer.textColor = '#64748b';

    refreshIn(w, 10);
    return w;
}

// Discret : délégation de mise à jour toutes les 10 min
function refreshIn(w, minutes) {
    w.refreshAfterDate = new Date(Date.now() + minutes * 60 * 1000);
}

function drawBackground() {
    const c = new DrawContext();
    c.size = new Size(400, 200);
    c.opaque = false;
    // Dégradé brand -> indigo, comme la PWA
    const gradient = new LinearGradient();
    gradient.colors = [
        new Color('#2563eb', 1),
        new Color('#4f46e5', 1)
    ];
    gradient.locations = [0, 1];
    c.setLinearGradient(gradient, new Point(0, 0), new Point(400, 200));
    c.fillRect(new Rect(0, 0, 400, 200));
    return c.getImage();
}

// ---- Exécution (IIFE : top-level await non fiable selon la version de Scriptable) ----
(async () => {
    let widget;
    try {
        const data = await fetchData();
        widget = await buildWidget(data);
    } catch (e) {
        widget = new ListWidget();
        const err = widget.addText('UVSQ EDT\nErreur réseau / identifiants');
        err.font = Font.semiboldSystemFont(12);
        err.textColor = '#f43f5e';
        refreshIn(widget, 5);
    }

    Script.setWidget(widget);
    Script.complete();
})();
