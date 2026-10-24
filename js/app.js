// App : état global, paramètres, synchro API UVSQ, initialisation.
// Le rendu et les interactions vivent dans js/ui.js, les helpers dans js/utils.js.

// CONFIGURATION STATE
let appConfig = {
    federationId: '22609743',
    cid: '-1742253826;1073733534;175432540;108',
    sourceMode: 'API',
    apiUser: '',
    apiPass: ''
};

// APPLICATION STATE
let selectedDate = new Date();
let activeViewMode = 'DAY';
let activeFilter = 'ALL';
let timetableData = [];

// NOTIFICATIONS : réglage persistant + anti-doublon par évènement
const NOTIFY_LEAD_MIN = 10;

// CHARGEMENT / SAUVEGARDE CONFIG
function loadSettings() {
    // Purge des anciens caches contenant les données de démo (DUPONT / MARTIN)
    Object.keys(localStorage).filter(k => k.startsWith('uvsq_edt_data_')).forEach(k => localStorage.removeItem(k));

    const saved = localStorage.getItem('uvsq_edt_config');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            // Force le mode API : toute config legacy en MOCK est ignorée
            if (parsed && parsed.sourceMode) parsed.sourceMode = 'API';
            appConfig = { ...appConfig, ...parsed };
        } catch(e) {}
    }
    document.getElementById('cfg-federation-id').value = appConfig.federationId;
    document.getElementById('cfg-cid').value = appConfig.cid;
    document.getElementById('cfg-api-user').value = appConfig.apiUser;
    document.getElementById('cfg-api-pass').value = appConfig.apiPass;
    document.getElementById('cfg-notify').checked = !!appConfig.notify;
}

// ONBOARDING : premier lancement — tout étudiant de l'IUT entre juste son
// numéro étudiant ; le CID par défaut suit son calendrier, quel que soit son groupe.
function isConfigured() {
    return !!localStorage.getItem('uvsq_edt_config');
}

function showOnboarding() {
    document.getElementById('onboarding-modal').classList.remove('hidden');

    // Auto-détection : si le serveur n'a pas ses propres identifiants CELCAT,
    // l'étudiant DOIT mettre les siens — on ouvre et rends requis le bloc ENT.
    // Avec des identifiants serveur, le n° étudiant seul suffit.
    fetch('/api/edt').then(res => res.json().then(data => ({ status: res.status, data }), () => ({ status: res.status, data: {} })))
        .then(({ status, data }) => {
            if (status === 401 && data.server_credentials_configured === false) {
                const details = document.getElementById('onboarding-ent-details');
                details.open = true;
                details.querySelector('summary').textContent = 'Mes identifiants ENT (nécessaires)';
                document.getElementById('onboarding-api-user').required = true;
                document.getElementById('onboarding-api-pass').required = true;
            }
        })
        .catch(() => { /* hors-ligne : la soumission gèrera l'erreur API le moment venu */ });
}

function saveOnboarding(e) {
    e.preventDefault();
    const id = document.getElementById('onboarding-federation-id').value.trim();
    if (!/^[0-9]{4,12}$/.test(id)) return;
    appConfig.federationId = id;
    // ENT optionnel requis selon l'auto-détection du serveur (showOnboarding) :
    // avec CELCAT_USERNAME/PASSWORD côté Vercel, le n° étudiant seul suffit.
    appConfig.apiUser = document.getElementById('onboarding-api-user').value.trim();
    appConfig.apiPass = document.getElementById('onboarding-api-pass').value;
    localStorage.setItem('uvsq_edt_config', JSON.stringify(appConfig));
    document.getElementById('onboarding-modal').classList.add('hidden');
    fetchTimetableData(true);
}

function saveSettings(e) {
    e.preventDefault();
    appConfig.federationId = document.getElementById('cfg-federation-id').value.trim() || '22609743';
    // CID : uniquement des chiffres, tiret et points-virgules (format CELCAT)
    const cidRaw = document.getElementById('cfg-cid').value.trim().replace(/\s+/g, '');
    appConfig.cid = /^-?[0-9;]+$/.test(cidRaw) && cidRaw ? cidRaw : '-1742253826;1073733534;175432540;108';
    appConfig.apiUser = document.getElementById('cfg-api-user').value.trim();
    appConfig.apiPass = document.getElementById('cfg-api-pass').value;
    appConfig.sourceMode = 'API';

    // Notifications : la permission doit être demandée dans un geste utilisateur (ce clic)
    const notifyWanted = document.getElementById('cfg-notify').checked;
    appConfig.notify = notifyWanted;
    if (notifyWanted && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    } else if (notifyWanted && typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        alert("Les notifications sont bloquées pour ce site dans le réglage du navigateur/Safari : autorisez-les pour recevoir les alertes de cours.");
    }

    localStorage.setItem('uvsq_edt_config', JSON.stringify(appConfig));
    toggleSettingsModal(false);
    fetchTimetableData(true);
}

// DÉCONNEXION RÉELLE : purge des identifiants + des caches de cours de cet appareil
function clearCredentials() {
    if (!confirm('Effacer vos identifiants UVSQ et les cours mis en cache de cet appareil ?')) return;
    appConfig.apiUser = '';
    appConfig.apiPass = '';
    localStorage.setItem('uvsq_edt_config', JSON.stringify(appConfig));
    Object.keys(localStorage).filter(k => k.startsWith('uvsq_edt_api_')).forEach(k => localStorage.removeItem(k));
    document.getElementById('cfg-api-user').value = '';
    document.getElementById('cfg-api-pass').value = '';
    timetableData = [];
    toggleSettingsModal(false);
    updateStatus('Déconnecté', 'rose');
    renderTimetable();
    showErrorState('Identifiants supprimés de cet appareil. Renseignez-les à nouveau dans les paramètres pour réafficher vos cours.');
}

// INDICATEUR « dernière synchro » : fraîcheur visible des données affichées
function setLastSync(ts) {
    const el = document.getElementById('last-sync');
    el.textContent = ts
        ? `Données CELCAT lues à ${new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
        : '';
}

function updateStatus(text, color) {
    document.getElementById('status-text').textContent = text;
    const dot = document.querySelector('#status-indicator span');
    dot.className = `w-2 h-2 rounded-full inline-block ${
        color === 'emerald' ? 'bg-emerald-500 animate-pulse' : 
        color === 'amber' ? 'bg-amber-500 animate-pulse' : 
        color === 'indigo' ? 'bg-indigo-500 animate-pulse' : 'bg-rose-500'
    }`;
}

// CHARGEMENT DONNEES
async function fetchTimetableData(forceRefresh = false) {
    const icon = document.getElementById('refresh-icon');
    icon.classList.add('fa-spin');
    updateStatus('Connexion UVSQ...', 'amber');

    // Purge de sécurité : tout ancien cache de données de démo est supprimé
    Object.keys(localStorage).filter(k => k.startsWith('uvsq_edt_data_')).forEach(k => localStorage.removeItem(k));

    const cacheKey = `uvsq_edt_api_${appConfig.federationId}_${appConfig.cid}`;
    let cache = null;
    try { cache = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch (e) { cache = null; }
    // Fraîcheur du cache : 1 h — au-delà, resynchronisation automatique à l'ouverture
    const cacheFresh = cache && Array.isArray(cache.events) && (Date.now() - cache.fetchedAt) < 60 * 60 * 1000;

    if (!forceRefresh && cacheFresh) {
        timetableData = cache.events;
        setLastSync(cache.fetchedAt);
        updateStatus('Cache Local (UVSQ)', 'emerald');
        renderTimetable();
        updateNextClassCountdown();
        icon.classList.remove('fa-spin');
        return;
    }

    try {
        const response = await fetch(`/api/edt?id=${encodeURIComponent(appConfig.federationId)}&cid=${encodeURIComponent(appConfig.cid)}`, {
            headers: {
                'x-celcat-user': appConfig.apiUser || '',
                'x-celcat-pass': appConfig.apiPass || ''
            }
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok && data.success && Array.isArray(data.events) && data.events.length > 0) {
            timetableData = data.events;
            const now = Date.now();
            localStorage.setItem(cacheKey, JSON.stringify({ events: timetableData, fetchedAt: now }));
            setLastSync(now);
            updateStatus('En Direct UVSQ (LDAP)', 'emerald');
        } else {
            timetableData = [];
            showErrorState(data.message || (data.error === 'missing_credentials'
                ? "Identifiants UVSQ manquants : renseignez-les dans les paramètres (bouton engrenage)."
                : `Erreur API /api/edt (HTTP ${response.status}).`));
            updateStatus('API UVSQ : erreur', 'rose');
        }
    } catch (error) {
        console.error('Erreur synchro UVSQ :', error);
        if (cache && Array.isArray(cache.events) && cache.events.length > 0) {
            timetableData = cache.events;
            setLastSync(cache.fetchedAt);
            updateStatus('Hors-ligne (cache UVSQ)', 'amber');
        } else {
            timetableData = [];
            showErrorState("Connexion à l'API impossible. Vérifiez le réseau, puis réessayez.");
            updateStatus('Hors-ligne', 'rose');
        }
    } finally {
        renderTimetable();
        updateNextClassCountdown();
        icon.classList.remove('fa-spin');
    }
}

// DÉTECTEUR D'INSTALLATION IOS SAFARI
function checkIosPrompt() {
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.navigator.standalone || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
    if (isIos && !isStandalone && !localStorage.getItem('ios_prompt_dismissed')) {
        document.getElementById('ios-prompt').classList.remove('hidden');
    }
}

function dismissIosPrompt() {
    localStorage.setItem('ios_prompt_dismissed', 'true');
    document.getElementById('ios-prompt').classList.add('hidden');
}

// INITIALISATION : chaque étape est isolée — une erreur d'une fonction
// d'init ne doit jamais empêcher le rendu et la synchro des cours
window.addEventListener('load', () => {
    const safe = fn => { try { fn(); } catch (e) { console.warn('Init bloqué (non fatal) :', e); } };
    safe(initDaysCarousel);   // affichage des jours d'abord, indépendant de tout le reste
    safe(loadSettings);
    safe(checkIosPrompt);
    safe(() => {
        if (isConfigured()) fetchTimetableData();
        else showOnboarding();   // premier lancement : avant toute synchro, on demande le n° étudiant
    });
    safe(startCountdownTimer);
});

// SERVICE WORKER : installation réelle de la PWA + consultation hors-ligne
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(e => {
            console.warn('Service Worker non enregistré :', e);
        });
    });
}
