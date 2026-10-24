// UI : vues Jour/Semaine/Mois, carrousel de jours, filtres, modales,
// compte à rebours. Les variables d'état (selectedDate, activeViewMode…)
// sont déclarées dans js/app.js et partagées via le scope global lexical.

// SWITCH VUES (JOUR / SEMAINE / MOIS)
function setViewMode(mode) {
    activeViewMode = mode;
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.remove('bg-brand-600', 'text-white', 'shadow-md', 'font-bold');
        btn.classList.add('text-slate-400', 'font-medium');
    });
    const activeBtn = document.getElementById(`view-${mode}`);
    activeBtn.classList.remove('text-slate-400', 'font-medium');
    activeBtn.classList.add('bg-brand-600', 'text-white', 'shadow-md', 'font-bold');

    document.getElementById('day-selector-container').classList.toggle('hidden', mode === 'MONTH');
    document.getElementById('month-nav').classList.toggle('hidden', mode !== 'MONTH');
    document.getElementById('month-nav').classList.toggle('flex', mode === 'MONTH');
    renderTimetable();
}

// CARROUSEL JOURS
function initDaysCarousel() {
    const container = document.getElementById('days-carousel');
    container.innerHTML = '';
    const curr = new Date(selectedDate);
    const firstDayOfWeek = new Date(curr.setDate(curr.getDate() - curr.getDay() + 1));
    const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

    for (let i = 0; i < 6; i++) {
        const dayDate = new Date(firstDayOfWeek);
        dayDate.setDate(firstDayOfWeek.getDate() + i);
        const isToday = isSameDay(dayDate, new Date());
        const isSelected = isSameDay(dayDate, selectedDate);

        const btn = document.createElement('button');
        btn.onclick = () => selectDate(dayDate);
        btn.className = `flex flex-col items-center justify-center min-w-[52px] py-2 px-2 rounded-2xl transition border text-xs active:scale-95 ${
            isSelected 
                ? 'bg-brand-600 text-white font-bold border-brand-500 shadow-lg shadow-brand-500/20' 
                : isToday 
                    ? 'bg-slate-800 text-brand-400 font-semibold border-brand-500/40' 
                    : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:border-slate-700'
        }`;
        btn.innerHTML = `
            <span class="text-[10px] uppercase tracking-wider opacity-80">${dayNames[i]}</span>
            <span class="text-sm font-bold mt-0.5">${dayDate.getDate()}</span>
        `;
        container.appendChild(btn);
    }
}

function changeDateOffset(offset) {
    if (activeViewMode === 'WEEK') selectedDate.setDate(selectedDate.getDate() + (offset * 7));
    else if (activeViewMode === 'MONTH') {
        // Navigation sur le 1er du mois : évite le débordement (31 janv + 1 mois qui sauterait février)
        const nm = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + offset, 1);
        selectedDate.setFullYear(nm.getFullYear(), nm.getMonth(), nm.getDate());
    }
    else selectedDate.setDate(selectedDate.getDate() + offset);
    initDaysCarousel();
    renderTimetable();
}

function selectDate(date) {
    selectedDate = new Date(date);
    initDaysCarousel();
    renderTimetable();
    updateNextClassCountdown();
}

// RENDU VUES
function renderTimetable() {
    const container = document.getElementById('timetable-container');
    const emptyState = document.getElementById('empty-state');
    const searchQuery = document.getElementById('search-input').value.toLowerCase();
    if (timetableData.length > 0) {
        emptyState.querySelector('h3').textContent = 'Aucun cours prévu';
        emptyState.querySelector('p').textContent = 'Profitez de votre journée libre ou ajustez vos critères de recherche !';
    }
    container.innerHTML = '';

    let filtered = timetableData.filter(evt => {
        if (activeFilter !== 'ALL' && evt.type !== activeFilter) return false;
        if (searchQuery) {
            return evt.title.toLowerCase().includes(searchQuery) ||
                   evt.room.toLowerCase().includes(searchQuery) ||
                   evt.prof.toLowerCase().includes(searchQuery);
        }
        return true;
    });

    if (activeViewMode === 'DAY') {
        renderDayView(container, filtered, selectedDate);
    } else if (activeViewMode === 'WEEK') {
        renderWeekView(container, filtered);
    } else if (activeViewMode === 'MONTH') {
        renderMonthView(container, filtered);
    }

    updatePeriodLabel();
    emptyState.classList.toggle('hidden', container.children.length > 0);
}

function showErrorState(msg) {
    const emptyState = document.getElementById('empty-state');
    emptyState.querySelector('h3').textContent = 'Impossible de récupérer les cours';
    emptyState.querySelector('p').textContent = msg;
}

// BANDEAU DE PERIODE : date précise selon la vue active
function updatePeriodLabel() {
    const el = document.getElementById('period-label');
    const full = d => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (activeViewMode === 'DAY') {
        el.textContent = full(selectedDate);
    } else if (activeViewMode === 'WEEK') {
        const mon = getStartOfWeek(selectedDate);
        const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
        el.textContent = `Semaine du ${mon.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' })} au ${fri.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}`;
    } else {
        el.textContent = selectedDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    }
}

function renderDayView(container, events, targetDate) {
    const dayEvents = events.filter(e => isSameDay(new Date(e.start), targetDate))
                            .sort((a, b) => new Date(a.start) - new Date(b.start));

    dayEvents.forEach(evt => container.appendChild(createEventCard(evt)));
}

function renderWeekView(container, events) {
    const monday = getStartOfWeek(selectedDate);
    const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
    const monthShort = selectedDate.toLocaleDateString('fr-FR', { month: 'short' });

    for (let i = 0; i < 5; i++) {
        const currentDay = new Date(monday);
        currentDay.setDate(monday.getDate() + i);
        const dayEvents = events.filter(e => isSameDay(new Date(e.start), currentDay))
                                .sort((a, b) => new Date(a.start) - new Date(b.start));

        const section = document.createElement('div');
        section.className = 'space-y-2';
        section.innerHTML = `
            <div class="text-xs font-bold uppercase tracking-wider text-slate-400 px-1 pt-2 flex items-center justify-between">
                <span>${dayNames[i]} ${currentDay.getDate()} ${currentDay.toLocaleDateString('fr-FR', { month: 'short' })}</span>
                <span class="text-[10px] text-slate-600 font-normal">${dayEvents.length} cours</span>
            </div>
        `;

        if (dayEvents.length === 0) {
            section.innerHTML += `<div class="p-3 text-xs text-slate-600 bg-slate-900/30 rounded-xl text-center">Aucun cours</div>`;
        } else {
            dayEvents.forEach(evt => section.appendChild(createEventCard(evt)));
        }
        container.appendChild(section);
    }
}

function renderMonthView(container, events) {
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-7 gap-1 bg-slate-900/80 p-2 rounded-2xl border border-slate-800 text-center text-xs';
    
    const daysHeader = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
    daysHeader.forEach(d => grid.innerHTML += `<div class="font-bold text-slate-500 py-1">${d}</div>`);

    const firstOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const startDay = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate();

    for (let i = 0; i < startDay; i++) {
        grid.innerHTML += `<div class="py-3 text-slate-800">.</div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const thisDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), day);
        const isSame = (e, d) => isSameDay(new Date(e.start), d);
        const dayCount = events.filter(e => isSame(e, thisDate)).length;
        const isToday = isSameDay(thisDate, new Date());
        const isSelected = isSameDay(thisDate, selectedDate);

        const cell = document.createElement('button');
        cell.onclick = () => { selectDate(thisDate); setViewMode('DAY'); };
        cell.className = `min-h-[44px] py-1.5 rounded-xl flex flex-col items-center justify-center relative ${
            isSelected ? 'bg-brand-600 text-white font-bold' :
            isToday ? 'bg-slate-800 text-brand-400 font-semibold' :
            'hover:bg-slate-800 text-slate-300'
        }`;
        cell.innerHTML = `
            <span>${day}</span>
            ${dayCount > 0 ? `<span class="text-[8px] font-bold leading-none mt-0.5 px-1 rounded-full ${isSelected ? 'bg-white/25 text-white' : 'bg-amber-400/15 text-amber-400'}">${dayCount}</span>` : ''}
        `;
        grid.appendChild(cell);
    }
    container.appendChild(grid);
}

function createEventCard(evt) {
    const card = document.createElement('div');
    const now = new Date();
    const start = new Date(evt.start);
    const end = new Date(evt.end);
    const isLive = now >= start && now <= end;

    let borderHighlight = evt.type === 'TD' ? 'border-l-emerald-500' : evt.type === 'TP' ? 'border-l-amber-500' : 'border-l-blue-500';
    if (isLive) borderHighlight = 'border-l-rose-500 ring-1 ring-rose-500/50 shadow-rose-500/10';

    // Textes CELCAT échappés : innerHTML + identifiants en localStorage => XSS inadmissible
    const esc = escapeHtml;

    card.onclick = () => toggleEventModal(true, evt);
    card.className = `bg-slate-900 border border-slate-800 rounded-2xl p-3.5 shadow-md flex flex-col gap-2 border-l-4 ${borderHighlight} transition active:scale-[0.98] cursor-pointer hover:border-slate-700`;
    card.innerHTML = `
        <div class="flex items-start justify-between gap-2">
            <div>
                <div class="flex items-center gap-1.5">
                    <span class="inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">${esc(evt.type)}</span>
                    ${isLive ? '<span class="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20 animate-pulse">En cours</span>' : ''}
                </div>
                <h3 class="text-xs sm:text-sm font-bold text-white leading-snug mt-1.5 line-clamp-2">${esc(evt.title)}</h3>
            </div>
            <div class="text-right flex-shrink-0">
                <div class="text-xs font-mono font-bold text-slate-200">${formatTime(start)}</div>
                <div class="text-[10px] font-mono text-slate-500">${formatTime(end)}</div>
            </div>
        </div>
        <div class="flex items-center justify-between text-[11px] text-slate-400 pt-1.5 border-t border-slate-800/60">
            <span class="font-semibold text-slate-200"><i class="fa-solid fa-location-dot text-rose-400 mr-1"></i>${esc(evt.room)}</span>
            <span class="text-slate-400"><i class="fa-solid fa-user-tie text-indigo-400 mr-1"></i>${esc(evt.prof)}</span>
        </div>
    `;
    return card;
}

function setFilter(filter) {
    activeFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('bg-brand-600', 'text-white', 'border-brand-500', 'font-medium');
        btn.classList.add('bg-slate-900', 'text-slate-400', 'border-slate-800');
    });
    const activeBtn = document.getElementById(`filter-${filter}`);
    activeBtn.classList.remove('bg-slate-900', 'text-slate-400', 'border-slate-800');
    activeBtn.classList.add('bg-brand-600', 'text-white', 'border-brand-500');
    renderTimetable();
}

// MODALE DÉTAIL COURS
function toggleEventModal(show, evt = null) {
    const modal = document.getElementById('event-modal');
    if (show && evt) {
        document.getElementById('modal-event-type').textContent = evt.type;
        document.getElementById('modal-event-title').textContent = evt.title;
        document.getElementById('modal-event-time').textContent = `${formatTime(new Date(evt.start))} - ${formatTime(new Date(evt.end))}`;
        document.getElementById('modal-event-room').textContent = evt.room;
        document.getElementById('modal-event-prof').textContent = evt.prof;
    }
    modal.classList.toggle('hidden', !show);
}

// MODALE PARAMÈTRES
function toggleSettingsModal(show) {
    document.getElementById('settings-modal').classList.toggle('hidden', !show);
}

// COMPTE À REBOURS : prochaine séance ou cours en cours
function updateNextClassCountdown() {
    const now = new Date();
    const upcoming = timetableData
        .map(e => ({ ...e, startDate: new Date(e.start), endDate: new Date(e.end) }))
        .filter(e => e.startDate > now)
        .sort((a, b) => a.startDate - b.startDate);

    // Statut live : cours en cours, ou compte à rebours du prochain
    const cdEl = document.getElementById('next-class-countdown');
    const live = timetableData.find(e => now >= new Date(e.start) && now <= new Date(e.end));
    if (live) {
        cdEl.textContent = `En cours · fin ${formatTime(new Date(live.end))}`;
    } else if (upcoming.length) {
        const mins = Math.round((upcoming[0].startDate - now) / 60000);
        if (mins < 1) cdEl.textContent = 'Démarrage imminent';
        else if (mins < 60) cdEl.textContent = `Début dans ${mins || 1} min`;
        else if (isSameDay(upcoming[0].startDate, now)) cdEl.textContent = `Début à ${formatTime(upcoming[0].startDate)}`;
        else cdEl.textContent = `${upcoming[0].startDate.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })} à ${formatTime(upcoming[0].startDate)}`;
    } else {
        cdEl.textContent = 'Rien à venir';
    }

    const titleEl = document.getElementById('next-class-title');
    const roomEl = document.getElementById('next-class-room');
    const timeEl = document.getElementById('next-class-time');
    const profEl = document.getElementById('next-class-prof');
    const badgeEl = document.getElementById('next-class-badge');

    if (upcoming.length === 0) {
        titleEl.textContent = "Aucun cours à venir";
        roomEl.textContent = "--";
        timeEl.textContent = "--:--";
        profEl.textContent = "--";
        badgeEl.textContent = "Libre";
        return;
    }

    const next = upcoming[0];
    titleEl.textContent = next.title;
    roomEl.textContent = next.room;
    timeEl.textContent = `${formatTime(new Date(next.start))} - ${formatTime(new Date(next.end))}`;
    profEl.textContent = next.prof;
    badgeEl.textContent = next.type;
}

function startCountdownTimer() {
    setInterval(() => {
        updateNextClassCountdown();
        // Re-rendu local (aucun réseau) : les cartes passent en « En cours »
        // et le badge de cours finissant se met à jour sans toucher l'app
        if (activeViewMode !== 'MONTH') renderTimetable();
    }, 30000);
}
