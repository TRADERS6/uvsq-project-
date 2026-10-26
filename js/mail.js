// Messagerie : liste des mails, lecture plein écran, rédaction avec
// autocomplétion des adresses (carnet = mails reçus + profs de l'EDT).
// Les identifiants Partage vivent dans appConfig (localStorage), comme l'ENT.
// Toute donnée affichée (sujets, corps, adresses) passe par escapeHtml :
// le contenu d'un mail est non fiable, aucun innerHTML brut n'est toléré.

let mailData = [];        // liste {uid, subject, from, to, date, unread}
let currentMail = null;   // mail ouvert dans le lecteur
let mailContacts = [];    // carnet d'adresses {name, address, fromEdt}

// ---------- identifiants Partage ----------
function getMailCreds() {
    return {
        user: appConfig.mailUser || appConfig.apiUser || '',
        pass: appConfig.mailPass || appConfig.apiPass || ''
    };
}

function hasMailCreds() {
    const c = getMailCreds();
    return !!(c.user && c.pass);
}

// ---------- bascule EDT <-> Messagerie (bottom nav) ----------
function switchTab(tab) {
    const isEdt = tab !== 'mail';

    // Sections principales : la vue EDT est portée par tous les éléments de
    // <main> sauf #view-mail ; on masque/affiche d'un seul appel.
    document.querySelectorAll('main > *:not(#view-mail)').forEach(el => el.classList.toggle('hidden', !isEdt));
    document.getElementById('view-mail').classList.toggle('hidden', isEdt);
    document.getElementById('btn-compose').classList.toggle('hidden', isEdt);

    // Boutons de la bottom nav
    const on = 'text-brand-400 bg-brand-500/10';
    const off = 'text-slate-500';
    const edtBtn = document.getElementById('tab-btn-edt');
    const mailBtn = document.getElementById('tab-btn-mail');
    edtBtn.classList.remove('text-brand-400', 'bg-brand-500/10', 'text-slate-500');
    mailBtn.classList.remove('text-brand-400', 'bg-brand-500/10', 'text-slate-500');
    edtBtn.classList.add(...(isEdt ? on : off).split(' '));
    mailBtn.classList.add(...(isEdt ? off : on).split(' '));

    // Entête suit l'onglet
    document.getElementById('header-title').textContent = isEdt ? 'UVSQ EDT' : 'UVSQ Mail';
    const icon = document.getElementById('header-icon');
    icon.className = isEdt ? 'fa-solid fa-calendar-days' : 'fa-solid fa-envelope';

    // Ouvre la messagerie : le cache local s'affiche instantanément, le réseau
    // rafraîchit ensuite en arrière-plan (EDT en mode "Cache Local" équivalent)
    if (!isEdt && mailData.length === 0) {
        const cache = loadMailCache();
        if (cache && cache.mails.length > 0) {
            mailData = cache.mails;
            document.getElementById('mail-need-creds').classList.add('hidden');
            updateMailBadge();
            buildAddressBook();
            renderMailList();
            showMailSyncStatus(`cache local du ${new Date(cache.fetchedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
        }
        if (hasMailCreds()) fetchMails(false);
        else document.getElementById('mail-need-creds').classList.remove('hidden');
    }
    window.scrollTo({ top: 0 });
}

// ---------- chargement de la liste ----------
async function fetchMails(force) {
    if (!hasMailCreds()) {
        document.getElementById('mail-need-creds').classList.remove('hidden');
        document.getElementById('mail-list').innerHTML = '';
        return;
    }
    document.getElementById('mail-need-creds').classList.add('hidden');
    document.getElementById('mail-loading').classList.remove('hidden');
    const icon = document.getElementById('mail-refresh-icon');
    icon.classList.add('fa-spin');

    try {
        const c = getMailCreds();
        const res = await fetch(`/api/mail${force ? '?limit=15' : ''}`, {
            headers: { 'x-mail-user': c.user, 'x-mail-pass': c.pass }
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok && data.success && Array.isArray(data.mails)) {
            mailData = data.mails;
            saveMailCache();
            showMailSyncStatus(`synchronisé à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · ${data.count} mail(s)`);
            updateMailBadge();
            buildAddressBook();
            renderMailList();
        } else if (data.error === 'bad_credentials') {
            // Identifiants refusés : le cache peut appartenir à un autre compte
            localStorage.removeItem('uvsq_mail_cache');
            mailData = [];
            renderMailError(data.message || 'Identifiants Partage refusés par le serveur.');
            showMailSyncStatus('identifiants refusés');
        } else if (res.status === 401) {
            mailData = [];
            renderMailError(data.message || 'Identifiants Partage refusés ou manquants.');
        } else {
            renderMailError(data.message || `Erreur API /api/mail (HTTP ${res.status}).`);
        }
    } catch (e) {
        // Hors-ligne ou API inaccessible : repli sur le dernier cache connu
        const cache = loadMailCache();
        if (cache && cache.mails.length > 0) {
            mailData = cache.mails;
            showMailSyncStatus(`hors-ligne (cache local du ${new Date(cache.fetchedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})`);
            updateMailBadge();
            buildAddressBook();
            renderMailList();
        } else {
            renderMailError('Connexion à la messagerie impossible. Vérifie le réseau, puis réessaie.');
        }
    } finally {
        document.getElementById('mail-loading').classList.add('hidden');
        icon.classList.remove('fa-spin');
    }
}

// ---------- cache local de la boîte (consultation hors-ligne) ----------
// Stocké uniquement sur l'appareil (localStorage), comme le cache EDT,
// purgé si les identifiants sont effacés ou refusés par le serveur.
function loadMailCache() {
    try {
        const cache = JSON.parse(localStorage.getItem('uvsq_mail_cache') || 'null');
        return cache && Array.isArray(cache.mails) ? cache : null;
    } catch (e) {
        return null;
    }
}

function saveMailCache() {
    try {
        localStorage.setItem('uvsq_mail_cache', JSON.stringify({ mails: mailData, fetchedAt: Date.now() }));
    } catch (e) { /* quota dépassé : pas bloquant */ }
}

function showMailSyncStatus(detail) {
    document.getElementById('mail-sync').textContent = `mail.partage.renater.fr · ${detail}`;
}

function renderMailError(msg) {
    const list = document.getElementById('mail-list');
    list.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'text-center py-10 px-4 bg-slate-900/40 rounded-2xl border border-slate-800/50';
    card.innerHTML = `
        <div class="w-14 h-14 mx-auto mb-3 rounded-full bg-slate-800/80 flex items-center justify-center text-slate-500 text-xl">
            <i class="fa-solid fa-triangle-exclamation"></i>
        </div>
        <h3 class="text-sm font-semibold text-white">Impossible de récupérer les e-mails</h3>
        <p class="text-xs text-slate-400 mt-1 max-w-xs mx-auto select-text">${escapeHtml(msg)}</p>`;
    list.appendChild(card);
}

// ---------- rendu de la liste (cartes mobiles, lisibles sans zoom) ----------
function formatMailDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const now = new Date();
    if (isSameDay(d, now)) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (isSameDay(d, yesterday)) return 'Hier';
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function renderMailList() {
    const list = document.getElementById('mail-list');
    list.innerHTML = '';
    const esc = escapeHtml;

    if (mailData.length === 0) {
        list.innerHTML = `
            <div class="text-center py-10 bg-slate-900/40 rounded-2xl border border-slate-800/50">
                <div class="w-14 h-14 mx-auto mb-3 rounded-full bg-slate-800/80 flex items-center justify-center text-slate-500 text-xl">
                    <i class="fa-solid fa-mug-hot"></i>
                </div>
                <h3 class="text-sm font-semibold text-white">Boîte vide</h3>
                <p class="text-xs text-slate-400 mt-1">Aucun e-mail dans ta boîte de réception.</p>
            </div>`;
        return;
    }

    mailData.forEach(m => {
        const card = document.createElement('div');
        card.onclick = () => openMailReader(m.uid);
        card.className = `bg-slate-900 border border-slate-800 rounded-2xl p-3.5 shadow-md flex flex-col gap-1.5 cursor-pointer transition active:scale-[0.98] hover:border-slate-700 border-l-4 ${m.unread ? 'border-l-brand-500' : 'border-l-slate-700'}`;
        const name = m.from && (m.from.name || m.from.address) || 'Expéditeur inconnu';
        card.innerHTML = `
            <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                    ${m.unread ? '<span class="w-2 h-2 rounded-full bg-brand-500 flex-shrink-0"></span>' : ''}
                    <p class="text-xs font-bold text-white truncate ${m.unread ? '' : 'text-slate-200'}">${esc(name)}</p>
                </div>
                <span class="text-[10px] font-mono text-slate-500 flex-shrink-0">${esc(formatMailDate(m.date))}</span>
            </div>
            <p class="text-xs ${m.unread ? 'text-slate-200 font-bold' : 'text-slate-400 font-medium'} line-clamp-2 leading-snug ${m.unread ? 'pl-4' : ''}">${esc(m.subject)}</p>
            ${m.preview ? `<p class="text-[11px] text-slate-500 line-clamp-2 leading-snug ${m.unread ? 'pl-4' : ''}">${esc(m.preview)}</p>` : ''}`;
        list.appendChild(card);
    });
}

// ---------- badge non lus de la bottom nav ----------
function updateMailBadge() {
    const badge = document.getElementById('mail-unread-badge');
    const n = mailData.filter(m => m.unread).length;
    if (n > 0) {
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

// ---------- lecteur plein écran ----------
async function openMailReader(uid) {
    if (!hasMailCreds()) return;
    const reader = document.getElementById('mail-reader');
    const bodyEl = document.getElementById('reader-body');
    const subjectEl = document.getElementById('reader-subject');

    // Aperçu immédiat depuis la liste
    const cached = mailData.find(m => m.uid === uid);
    subjectEl.textContent = cached ? cached.subject : 'Chargement…';
    bodyEl.textContent = 'Chargement du message…';
    reader.classList.remove('hidden');

    try {
        const c = getMailCreds();
        const res = await fetch(`/api/mail?uid=${encodeURIComponent(uid)}`, {
            headers: { 'x-mail-user': c.user, 'x-mail-pass': c.pass }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success || !data.mail) {
            bodyEl.textContent = data.message || `Erreur de chargement (HTTP ${res.status}).`;
            return;
        }
        currentMail = data.mail;
        renderMailReader(data.mail);

        // Marque lu côté client (le serveur a déjà flaggé \Seen) : persiste
        // dans le cache local pour que le badge non-lus reste juste hors-ligne
        if (cached && cached.unread) {
            cached.unread = false;
            updateMailBadge();
            saveMailCache();
        }
    } catch (e) {
        bodyEl.textContent = "Connexion impossible. Vérifie le réseau puis réessaie.";
    }
}

function renderMailReader(mail) {
    document.getElementById('reader-subject').textContent = mail.subject;
    const from = mail.from || { name: 'Inconnu', address: '' };
    document.getElementById('reader-from-name').textContent = from.name || from.address || 'Inconnu';
    document.getElementById('reader-from-addr').textContent = from.address || '';
    document.getElementById('reader-date').textContent = mail.date
        ? new Date(mail.date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
        : '';
    document.getElementById('reader-to').innerHTML = mail.to && mail.to.length
        ? `À : ${escapeHtml(mail.to.map(t => t.name ? `${t.name} <${t.address}>` : t.address).join(', '))}`
        : '';
    document.getElementById('reader-body').textContent = mail.text || '(Message vide)';

    const attach = document.getElementById('reader-attachments');
    attach.innerHTML = '';
    if (mail.attachments && mail.attachments.length > 0) {
        mail.attachments.forEach(a => {
            const chip = document.createElement('span');
            chip.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-900 border border-slate-700 text-[10px] text-slate-300 rounded-xl';
            chip.innerHTML = `<i class="fa-solid fa-paperclip text-slate-500"></i><span class="truncate max-w-[9rem]">${escapeHtml(a.name)}</span>`;
            attach.appendChild(chip);
        });
        attach.classList.remove('hidden');
    } else {
        attach.classList.add('hidden');
    }
}

function closeMailReader() {
    document.getElementById('mail-reader').classList.add('hidden');
    renderMailList();
}

// ---------- rédaction ----------
function replyToCurrentMail() {
    if (!currentMail || !currentMail.from) return;
    const subject = /^(re|ar)\s*:/i.test(currentMail.subject) ? currentMail.subject : `RE: ${currentMail.subject}`;
    const attribution = `Le ${new Date(currentMail.date || Date.now()).toLocaleString('fr-FR')}, ${currentMail.from.name || currentMail.from.address} a écrit :\n\n`;
    openCompose({ to: currentMail.from.address, subject, text: attribution });
}

function openCompose(prefill = {}) {
    document.getElementById('compose-to').value = prefill.to || '';
    document.getElementById('compose-subject').value = prefill.subject || '';
    document.getElementById('compose-text').value = prefill.text || '';
    document.getElementById('compose-error').classList.add('hidden');
    document.getElementById('mail-compose').classList.remove('hidden');
    setTimeout(() => document.getElementById('compose-to').focus(), 50);
}

function closeCompose() {
    document.getElementById('mail-compose').classList.add('hidden');
}

function showComposeError(msg) {
    const box = document.getElementById('compose-error');
    box.textContent = msg;
    box.classList.remove('hidden');
}

async function handleSendMail(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    if (!hasMailCreds()) {
        showComposeError('Renseigne tes identifiants Partage dans les paramètres avant d\'envoyer.');
        return;
    }

    const to = document.getElementById('compose-to').value.trim();
    const subject = document.getElementById('compose-subject').value.trim();
    const text = document.getElementById('compose-text').value.trim();

    if (!to) {
        showComposeError('Indique au moins un destinataire (autocomplétion : tape un nom de prof).');
        return;
    }
    if (!text) {
        showComposeError('Ton message est vide.');
        return;
    }

    const sendBtn = document.getElementById('compose-send');
    const sendIcon = document.getElementById('compose-send-icon');
    sendBtn.disabled = true;
    sendBtn.classList.add('opacity-70');
    sendIcon.classList.add('fa-spin');
    document.getElementById('compose-error').classList.add('hidden');

    try {
        const c = getMailCreds();
        const res = await fetch('/api/mail', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-mail-user': c.user,
                'x-mail-pass': c.pass
            },
            body: JSON.stringify({ to, subject, text })
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok && data.success) {
            document.getElementById('mail-compose').classList.add('hidden');
            fetchMails(true);
        } else {
            showComposeError(data.message || `Envoi échoué (HTTP ${res.status}).`);
        }
    } catch (e) {
        showComposeError('Connexion impossible. Vérifie le réseau puis réessaie.');
    } finally {
        sendBtn.disabled = false;
        sendBtn.classList.remove('opacity-70');
        sendIcon.classList.remove('fa-spin');
    }
}

// ---------- carnet d'adresses / autocomplétion ----------
// Sources : adresses vues dans les mails reçus (fiables) + profs de l'EDT
// (adresse déduite prenom.nom@uvsq.fr quand elle n'est pas déjà connue).
function removeAllAccents(s) {
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function splitProfName(raw) {
    const tokens = String(raw || '').split(/[\s.]+/).filter(Boolean);
    if (tokens.length < 2) return null;
    // CELCAT tape souvent le nom en MAJUSCULES : on l'identifie, l'autre token est le prénom
    let nom = null, prenom = null;
    for (const t of tokens) {
        if (t === t.toUpperCase() && t.length > 2) nom = nom || t;
        else prenom = prenom || t;
    }
    if (!nom && tokens.length >= 2) { nom = tokens[1]; prenom = tokens[0]; }
    if (!nom || !prenom) { nom = nom || tokens[tokens.length - 1]; prenom = prenom || tokens[0]; }
    const slug = t => removeAllAccents(t).toLowerCase().replace(/[^a-z]/g, '');
    const n = slug(nom), p = slug(prenom);
    if (!n || !p) return null;
    return { prenom: p, nom: n };
}

function buildAddressBook() {
    const book = new Map(); // address -> {name, verified}

    // 1. Fiable : adresses des mails reçus (From + destinataires To)
    for (const m of mailData) {
        const add = (person) => {
            if (!person || !person.address) return;
            if (!book.has(person.address)) book.set(person.address, { name: person.name || person.address, verified: true });
        };
        add(m.from);
        (m.to || []).forEach(add);
    }

    // 2. Profs de l'EDT : reconnus dans le carnet, sinon adresse déduite
    const seenProfs = new Set();
    for (const evt of timetableData) {
        const prof = String(evt.prof || '').trim();
        if (!prof || prof === '--' || seenProfs.has(prof)) continue;
        seenProfs.add(prof);
        const parts = splitProfName(prof);
        if (!parts) continue;

        // Match par nom dans les adresses venues des mails
        let matched = null;
        for (const [addr, entry] of book) {
            const n = splitProfName(entry.name);
            if (n && (n.nom === parts.nom || addr.toLowerCase().includes(parts.nom))) {
                matched = addr;
                break;
            }
        }
        if (matched) {
            book.get(matched).name = book.get(matched).name || prof;
        } else {
            const guessed = `${parts.prenom}.${parts.nom}@uvsq.fr`;
            if (!book.has(guessed)) book.set(guessed, { name: `${prof} (adresse déduite, à vérifier)`, verified: false });
        }
    }

    mailContacts = [...book.entries()].map(([address, v]) => ({ address, name: v.name }));
    renderAddressDatalist();
}

function renderAddressDatalist() {
    const datalist = document.getElementById('mail-addresses');
    datalist.innerHTML = '';
    for (const c of mailContacts) {
        const opt = document.createElement('option');
        opt.value = c.address;
        opt.label = c.name;
        datalist.appendChild(opt);
    }
}
