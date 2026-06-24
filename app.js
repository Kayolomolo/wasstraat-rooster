// ============ DATA STORE ============
const _memoryStore = {};
let _useLocalStorage = false;
try {
    localStorage.setItem('_test', '1');
    localStorage.removeItem('_test');
    _useLocalStorage = true;
} catch {}

let _saveTimeout = null;

const Store = {
    get(key, fallback) {
        try {
            const raw = _useLocalStorage
                ? localStorage.getItem('wasstraat_' + key)
                : _memoryStore['wasstraat_' + key];
            return raw ? JSON.parse(raw) : fallback;
        } catch { return fallback; }
    },
    set(key, val) {
        const raw = JSON.stringify(val);
        if (_useLocalStorage) {
            localStorage.setItem('wasstraat_' + key, raw);
        }
        _memoryStore['wasstraat_' + key] = raw;
    }
};

// BELANGRIJK: Vervang deze URL met jouw Worker URL na het aanmaken
const WORKER_URL = 'https://bob-rooster-api.JOUW-ACCOUNT.workers.dev';

async function syncToCloud() {
    clearTimeout(_saveTimeout);
    _saveTimeout = setTimeout(async () => {
        try {
            const data = { employees, availability, leaves, schedules, settings, kassaTransactions };
            await fetch(WORKER_URL + '/data', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } catch {}
    }, 1000);
}

async function loadFromCloud() {
    try {
        const res = await fetch(WORKER_URL + '/data');
        const data = await res.json();
        if (data && data.employees && data.employees.length > 0) {
            employees = data.employees;
            availability = data.availability || {};
            leaves = data.leaves || [];
            schedules = data.schedules || {};
            settings = data.settings || settings;
            if (data.kassaTransactions) kassaTransactions = data.kassaTransactions;
            save();
            renderKassa();
            renderEmployees();
            updateEmployeeSelects();
            loadSettings();
            renderRooster();
        }
    } catch {}
}

// ============ STATE ============
let employees = Store.get('employees', []);
let availability = Store.get('availability', {});
let leaves = Store.get('leaves', []);
let schedules = Store.get('schedules', {});
let settings = Store.get('settings', {
    minMorning: 2,
    minClosing: 2,
    mondayClean: true,
    wednesdayMaint: true,
    breakMinutes: 30
});

let currentWeekOffset = 0;

// ============ HELPERS ============
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function save() {
    Store.set('employees', employees);
    Store.set('availability', availability);
    Store.set('leaves', leaves);
    Store.set('schedules', schedules);
    Store.set('settings', settings);
    Store.set('kassaTransactions', kassaTransactions);
    syncToCloud();
}

function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2500);
}

function getMonday(weekOffset) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const day = now.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(now.getTime() + diffToMonday * 86400000 + weekOffset * 7 * 86400000);
    monday.setHours(0, 0, 0, 0);
    return monday;
}

function getWeekDates(weekOffset) {
    const monday = getMonday(weekOffset);
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday.getTime() + i * 86400000);
        d.setHours(0, 0, 0, 0);
        dates.push(d);
    }
    return dates;
}

function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getDayName(d) {
    return ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'][d.getDay()];
}

function getShortDay(d) {
    return ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'][d.getDay()];
}

function getWeekNumber(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function isOnLeave(empId, dateStr) {
    return leaves.some(l =>
        l.employeeId === empId && dateStr >= l.start && dateStr <= l.end
    );
}

function isAvailable(empId, dayIndex) {
    const empAvail = availability[empId];
    if (!empAvail) return true;
    return empAvail[dayIndex] !== 'unavailable';
}

function prefersDay(empId, dayIndex) {
    const empAvail = availability[empId];
    if (!empAvail) return false;
    return empAvail[dayIndex] === 'preferred';
}

// ============ TABS ============
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');

        if (btn.dataset.tab === 'kassa') renderKassa();
        if (btn.dataset.tab === 'beschikbaarheid') renderAvailability();
        if (btn.dataset.tab === 'verlof') renderLeaves();
        if (btn.dataset.tab === 'rooster') renderRooster();
    });
});

// ============ EMPLOYEES ============
function renderEmployees() {
    const list = document.getElementById('employee-list');
    if (employees.length === 0) {
        list.innerHTML = '<p style="color:#999;padding:1rem;">Nog geen medewerkers toegevoegd.</p>';
        return;
    }
    list.innerHTML = employees.map(emp => {
        const contractLabel = emp.contract === 'vast' ? 'Vast contract' : '0-uren contract';
        return `
        <div class="employee-card">
            <div class="emp-info">
                <span class="emp-name">${emp.name}</span>
                <span class="emp-details">${contractLabel} · Max ${emp.maxHours} uur/week${emp.role ? ' · ' + emp.role : ''}</span>
            </div>
            <div class="emp-actions">
                <select data-action="contract" data-id="${emp.id}">
                    <option value="vast" ${emp.contract === 'vast' ? 'selected' : ''}>Vast</option>
                    <option value="0uren" ${emp.contract === '0uren' ? 'selected' : ''}>0-uren</option>
                </select>
                <label>Max uren: <input type="number" value="${emp.maxHours}" min="1" max="60"
                    data-action="maxhours" data-id="${emp.id}"></label>
                <button class="btn-danger" data-action="remove" data-id="${emp.id}">Verwijderen</button>
            </div>
        </div>`;
    }).join('');
}

document.getElementById('add-employee-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('emp-name').value.trim();
    const maxHours = parseInt(document.getElementById('emp-max-hours').value);
    const contract = document.getElementById('emp-contract').value;
    const role = document.getElementById('emp-role').value.trim();

    if (!name || !maxHours) return;

    employees.push({ id: generateId(), name, maxHours, contract, role });
    save();
    renderEmployees();
    updateEmployeeSelects();
    e.target.reset();
    toast(`${name} toegevoegd`);
});

document.getElementById('employee-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-action="remove"]');
    if (!btn) return;
    const id = btn.dataset.id;
    const emp = employees.find(e => e.id === id);
    if (!emp) return;
    if (!confirm(`Weet je zeker dat je ${emp.name} wilt verwijderen?`)) return;
    employees = employees.filter(e => e.id !== id);
    delete availability[id];
    leaves = leaves.filter(l => l.employeeId !== id);
    save();
    renderEmployees();
    updateEmployeeSelects();
    toast(`${emp.name} verwijderd`);
});

document.getElementById('employee-list').addEventListener('change', e => {
    const el = e.target;
    const id = el.dataset.id;
    if (!id) return;
    const emp = employees.find(e => e.id === id);
    if (!emp) return;
    if (el.dataset.action === 'contract') {
        emp.contract = el.value;
        save();
        renderEmployees();
        toast('Contract bijgewerkt');
    } else if (el.dataset.action === 'maxhours') {
        emp.maxHours = parseInt(el.value) || 1;
        save();
        toast('Max uren bijgewerkt');
    }
});

function updateEmployeeSelects() {
    const selects = [document.getElementById('avail-employee'), document.getElementById('leave-employee')];
    selects.forEach(sel => {
        if (!sel) return;
        sel.innerHTML = employees.length === 0
            ? '<option value="">Geen medewerkers</option>'
            : employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
    });
}

// ============ AVAILABILITY ============
const dayNames = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'];
// slot indices: 0=Ochtend, 1=Tussen, 2=Sluiting, 3=Schoonmaak, 4=Techniek
const timeSlots = [
    'Ochtend (07:30 - 14:00)',
    'Tussen (11:00 - 16:00)',
    'Sluiting (14:00 - 20:30)',
    'Schoonmaak (20:00 - 22:00)',
    'Techniek (20:00 - 22:30)'
];

function renderAvailability() {
    const sel = document.getElementById('avail-employee');
    const currentVal = sel.value;
    updateEmployeeSelects();
    if (currentVal && employees.some(e => e.id === currentVal)) {
        sel.value = currentVal;
    }
    const grid = document.getElementById('availability-grid');
    const empId = sel.value;

    if (!empId) {
        grid.innerHTML = '<p style="color:#999;padding:1rem;">Voeg eerst medewerkers toe.</p>';
        return;
    }

    if (!availability[empId]) {
        availability[empId] = {};
        for (let i = 0; i < 7; i++) {
            for (let s = 0; s < 5; s++) {
                availability[empId][`${i}_${s}`] = 'unavailable';
            }
        }
        save();
    } else {
        let changed = false;
        for (let i = 0; i < 7; i++) {
            for (let s = 0; s < 5; s++) {
                if (availability[empId][`${i}_${s}`] === undefined) {
                    availability[empId][`${i}_${s}`] = 'unavailable';
                    changed = true;
                }
            }
        }
        if (changed) save();
    }

    const empAvail = availability[empId];

    let html = '<table class="avail-table"><thead><tr><th></th>';
    dayNames.forEach(d => { html += `<th>${d}</th>`; });
    html += '</tr></thead><tbody>';

    timeSlots.forEach((slot, si) => {
        html += `<tr><td><strong>${slot}</strong></td>`;
        for (let di = 0; di < 7; di++) {
            const key = `${di}_${si}`;
            const status = empAvail[key] || 'available';
            const label = status === 'available' ? 'Beschikbaar' : status === 'fixed' ? 'Vast' : status === 'preferred' ? 'Voorkeur' : 'Niet beschikbaar';
            html += `<td class="${status}" data-key="${key}" data-status="${status}">${label}</td>`;
        }
        html += '</tr>';
    });

    html += '</tbody></table>';
    html += `<div class="avail-legend">
        <div class="legend-item"><span class="legend-dot" style="background:#d4edda"></span> Beschikbaar</div>
        <div class="legend-item"><span class="legend-dot" style="background:#fff3cd"></span> Vast</div>
        <div class="legend-item"><span class="legend-dot" style="background:#f8d7da"></span> Niet beschikbaar</div>
    </div>`;

    grid.innerHTML = html;
}

document.getElementById('availability-grid').addEventListener('click', e => {
    const td = e.target.closest('td[data-key]');
    if (!td) return;
    const states = ['available', 'fixed', 'unavailable'];
    const labels = ['Beschikbaar', 'Vast', 'Niet beschikbaar'];
    const current = states.indexOf(td.dataset.status);
    const next = (current === -1 ? 1 : (current + 1)) % 3;
    td.className = states[next];
    td.dataset.status = states[next];
    td.textContent = labels[next];
});

document.getElementById('avail-employee').addEventListener('change', renderAvailability);

document.getElementById('save-availability').addEventListener('click', () => {
    const empId = document.getElementById('avail-employee').value;
    if (!empId) return;

    const cells = document.querySelectorAll('.avail-table td[data-key]');
    const empAvail = {};
    cells.forEach(cell => {
        empAvail[cell.dataset.key] = cell.dataset.status;
    });
    availability[empId] = empAvail;
    save();
    toast('Beschikbaarheid opgeslagen');
});

document.getElementById('reset-availability').addEventListener('click', () => {
    const empId = document.getElementById('avail-employee').value;
    if (!empId) return;
    const emp = employees.find(e => e.id === empId);
    if (!confirm(`Beschikbaarheid van ${emp ? emp.name : 'deze medewerker'} resetten?`)) return;
    delete availability[empId];
    save();
    renderAvailability();
    toast('Beschikbaarheid gereset');
});

document.getElementById('reset-all-availability').addEventListener('click', () => {
    if (!confirm('Alle beschikbaarheid van ALLE medewerkers wissen? Je moet daarna alles opnieuw instellen.')) return;
    availability = {};
    save();
    renderAvailability();
    toast('Alle beschikbaarheid gereset');
});

// ============ LEAVES ============
function renderLeaves() {
    updateEmployeeSelects();
    const list = document.getElementById('leave-list');

    if (leaves.length === 0) {
        list.innerHTML = '<p style="color:#999;padding:1rem;">Geen verlof geregistreerd.</p>';
        return;
    }

    list.innerHTML = leaves.map(l => {
        const emp = employees.find(e => e.id === l.employeeId);
        return `<div class="leave-card">
            <div class="leave-info">
                <span class="leave-name">${emp ? emp.name : 'Onbekend'}</span>
                <span class="leave-dates">${l.start} t/m ${l.end}</span>
                ${l.reason ? `<span class="leave-reason">${l.reason}</span>` : ''}
            </div>
            <button class="btn-danger" data-action="remove-leave" data-id="${l.id}">Verwijderen</button>
        </div>`;
    }).join('');
}

document.getElementById('leave-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-action="remove-leave"]');
    if (!btn) return;
    leaves = leaves.filter(l => l.id !== btn.dataset.id);
    save();
    renderLeaves();
    toast('Verlof verwijderd');
});

document.getElementById('add-leave-form').addEventListener('submit', e => {
    e.preventDefault();
    const employeeId = document.getElementById('leave-employee').value;
    const start = document.getElementById('leave-start').value;
    const end = document.getElementById('leave-end').value;
    const reason = document.getElementById('leave-reason').value.trim();

    if (!employeeId || !start || !end) return;
    if (end < start) { toast('Einddatum moet na startdatum zijn'); return; }

    leaves.push({ id: generateId(), employeeId, start, end, reason });
    save();
    renderLeaves();
    e.target.reset();
    document.getElementById('leave-employee').value = employeeId;
    toast('Verlof toegevoegd');
});


// ============ SCHEDULE GENERATOR ============
function generateSchedule(weekOffset) {
    const dates = getWeekDates(weekOffset);
    const weekKey = formatDate(dates[0]);
    const schedule = {};

    const weekHours = {};
    employees.forEach(e => { weekHours[e.id] = 0; });

    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        const date = dates[dayIdx];
        const dateStr = formatDate(date);
        const jsDay = date.getDay(); // 0=Sun
        const dayKey = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon

        const isSunday = jsDay === 0;
        const isMonday = jsDay === 1;
        const isWednesday = jsDay === 3;

        const openTime = isSunday ? '10:00' : '08:00';
        const openerTime = isSunday ? '09:30' : '07:30';
        const closeTime = '20:00';
        const closerTime = '20:30';

        const regularHours = isSunday ? 10 : 12;
        const openerHours = regularHours + 0.5;
        const closerHours = regularHours / 2 + 0.5;
        const morningHours = regularHours / 2;
        const afternoonHours = regularHours / 2;

        const breakHours = settings.breakMinutes / 60;

        const notOnLeave = employees.filter(emp => !isOnLeave(emp.id, dateStr));

        const availableEmps = notOnLeave.filter(emp =>
            isAvailableForDay(emp.id, dayKey)
        );

        if (availableEmps.length === 0 && notOnLeave.length === 0) {
            schedule[dateStr] = { shifts: [], warning: 'Geen beschikbare medewerkers' };
            continue;
        }

        const shifts = [];

        const sortedByHours = [...availableEmps].sort((a, b) => {
            const contractA = a.contract === 'vast' ? 0 : 1;
            const contractB = b.contract === 'vast' ? 0 : 1;
            if (contractA !== contractB) return contractA - contractB;
            const fixedA = [0,1,2].some(s => isFixedForSlot(a.id, dayKey, s)) ? -1 : 0;
            const fixedB = [0,1,2].some(s => isFixedForSlot(b.id, dayKey, s)) ? -1 : 0;
            if (fixedA !== fixedB) return fixedA - fixedB;
            return (weekHours[a.id] || 0) - (weekHours[b.id] || 0);
        });

        // Assign opener (1 person, 30 min early) — slot 0 (ochtend)
        const opener = pickEmployeeForSlot(sortedByHours, weekHours, openerHours - breakHours, [], dayKey, 0);
        if (opener) {
            shifts.push({
                employeeId: opener.id,
                name: opener.name,
                type: 'opener',
                start: openerTime,
                end: '14:00',
                hours: morningHours + 0.5 - breakHours
            });
            weekHours[opener.id] = (weekHours[opener.id] || 0) + morningHours + 0.5 - breakHours;
        }

        // Assign remaining morning staff
        const assigned = opener ? [opener.id] : [];
        for (let i = 1; i < settings.minMorning; i++) {
            const emp = pickEmployeeForSlot(sortedByHours, weekHours, morningHours - breakHours, assigned, dayKey, 0);
            if (emp) {
                shifts.push({
                    employeeId: emp.id,
                    name: emp.name,
                    type: 'morning',
                    start: openTime,
                    end: '14:00',
                    hours: morningHours - breakHours
                });
                weekHours[emp.id] = (weekHours[emp.id] || 0) + morningHours - breakHours;
                assigned.push(emp.id);
            }
        }

        // Assign tussendienst (11:00 - 16:00, slot 1)
        const tussenHours = 5 - breakHours;
        const tussenEmp = pickEmployeeForSlot(sortedByHours, weekHours, tussenHours, assigned, dayKey, 1);
        if (tussenEmp) {
            shifts.push({
                employeeId: tussenEmp.id,
                name: tussenEmp.name,
                type: 'tussen',
                start: '11:00',
                end: '16:00',
                hours: tussenHours
            });
            weekHours[tussenEmp.id] = (weekHours[tussenEmp.id] || 0) + tussenHours;
            assigned.push(tussenEmp.id);
        }

        // Assign closers (2 people, 30 min late)
        for (let i = 0; i < settings.minClosing; i++) {
            const emp = pickEmployeeForSlot(sortedByHours, weekHours, afternoonHours + 0.5 - breakHours, assigned, dayKey, 2);
            if (emp) {
                shifts.push({
                    employeeId: emp.id,
                    name: emp.name,
                    type: 'closing',
                    start: '14:00',
                    end: closerTime,
                    hours: afternoonHours + 0.5 - breakHours
                });
                weekHours[emp.id] = (weekHours[emp.id] || 0) + afternoonHours + 0.5 - breakHours;
                assigned.push(emp.id);
            }
        }

        // Sorted list of all non-leave employees for evening shifts
        const sortedEvening = [...notOnLeave].sort((a, b) => {
            const contractA = a.contract === 'vast' ? 0 : 1;
            const contractB = b.contract === 'vast' ? 0 : 1;
            if (contractA !== contractB) return contractA - contractB;
            return (weekHours[a.id] || 0) - (weekHours[b.id] || 0);
        });

        // Evening shifts use separate exclude list (people can work a day shift + evening shift)
        const assignedEvening = [];

        // Monday cleaning shift (min 2 schoonmakers)
        if (isMonday && settings.mondayClean) {
            const mondayCleanMin = settings.mondayCleanMin || 2;
            for (let i = 0; i < mondayCleanMin; i++) {
                const cleaner = pickEmployeeForSlot(sortedEvening, weekHours, 2, assignedEvening, dayKey, 3);
                if (cleaner) {
                    shifts.push({
                        employeeId: cleaner.id,
                        name: cleaner.name,
                        type: 'clean',
                        start: '20:00',
                        end: '22:00',
                        hours: 2
                    });
                    weekHours[cleaner.id] = (weekHours[cleaner.id] || 0) + 2;
                    assignedEvening.push(cleaner.id);
                }
            }
        }

        // Wednesday: techniek (slot 4) + schoonmaak (slot 3)
        if (isWednesday && settings.wednesdayMaint) {
            const wedTechMin = settings.wedTechMin || 1;
            const wedCleanMin = settings.wedCleanMin || 1;
            for (let i = 0; i < wedTechMin; i++) {
                const tech = pickEmployeeForSlot(sortedEvening, weekHours, 2.5, assignedEvening, dayKey, 4);
                if (tech) {
                    shifts.push({
                        employeeId: tech.id,
                        name: tech.name,
                        type: 'maintenance',
                        start: '20:00',
                        end: '22:30',
                        hours: 2.5
                    });
                    weekHours[tech.id] = (weekHours[tech.id] || 0) + 2.5;
                    assignedEvening.push(tech.id);
                }
            }
            for (let i = 0; i < wedCleanMin; i++) {
                const cleaner = pickEmployeeForSlot(sortedEvening, weekHours, 2, assignedEvening, dayKey, 3);
                if (cleaner) {
                    shifts.push({
                        employeeId: cleaner.id,
                        name: cleaner.name,
                        type: 'clean',
                        start: '20:00',
                        end: '22:00',
                        hours: 2
                    });
                    weekHours[cleaner.id] = (weekHours[cleaner.id] || 0) + 2;
                    assignedEvening.push(cleaner.id);
                }
            }
        }

        let warning = null;
        const morningCount = shifts.filter(s => s.type === 'opener' || s.type === 'morning').length;
        const closingCount = shifts.filter(s => s.type === 'closing').length;
        if (morningCount < settings.minMorning) warning = `Tekort ochtend: ${morningCount}/${settings.minMorning}`;
        if (closingCount < settings.minClosing) warning = (warning ? warning + ' | ' : '') + `Tekort sluiting: ${closingCount}/${settings.minClosing}`;

        schedule[dateStr] = { shifts, warning };
    }

    schedules[weekKey] = schedule;
    save();
    return schedule;
}

// slotIndex: 0=Ochtend, 1=Middag, 2=Sluiting, 3=Schoonmaak, 4=Techniek
function isAvailableForSlot(empId, dayKey, slotIndex) {
    const empAvail = availability[empId];
    if (!empAvail) return true;
    const raw = (empAvail[`${dayKey}_${slotIndex}`] || '').trim().split(/\s+/)[0];
    return raw !== 'unavailable';
}

function getSlotStatus(empId, dayKey, slotIndex) {
    const empAvail = availability[empId];
    if (!empAvail) return 'available';
    return (empAvail[`${dayKey}_${slotIndex}`] || '').trim().split(/\s+/)[0] || 'available';
}

function isFixedForSlot(empId, dayKey, slotIndex) {
    return getSlotStatus(empId, dayKey, slotIndex) === 'fixed';
}

function isAvailableForDay(empId, dayKey) {
    const empAvail = availability[empId];
    if (!empAvail) return true;
    return [0, 1, 2].some(s => {
        const st = (empAvail[`${dayKey}_${s}`] || '').trim().split(/\s+/)[0];
        return st !== 'unavailable';
    });
}

function pickEmployeeForSlot(sorted, weekHours, shiftHours, excludeIds, dayKey, slotIndex) {
    // First: fixed employees always get priority
    for (const emp of sorted) {
        if (excludeIds.includes(emp.id)) continue;
        if (isFixedForSlot(emp.id, dayKey, slotIndex)) {
            return emp;
        }
    }
    // Second: available employees that fit within max hours
    for (const emp of sorted) {
        if (excludeIds.includes(emp.id)) continue;
        if (!isAvailableForSlot(emp.id, dayKey, slotIndex)) continue;
        if ((weekHours[emp.id] || 0) + shiftHours <= emp.maxHours) {
            return emp;
        }
    }
    // Third: available employees, over max hours
    for (const emp of sorted) {
        if (excludeIds.includes(emp.id)) continue;
        if (!isAvailableForSlot(emp.id, dayKey, slotIndex)) continue;
        return emp;
    }
    return null;
}

// ============ RENDER ROOSTER ============
function renderRooster() {
    const dates = getWeekDates(currentWeekOffset);
    const weekKey = formatDate(dates[0]);
    const monday = dates[0];

    document.getElementById('week-label').textContent =
        `Week ${getWeekNumber(monday)} - ${monday.getFullYear()}`;

    const schedule = schedules[weekKey];
    const grid = document.getElementById('rooster-grid');

    if (!schedule) {
        grid.innerHTML = '<p style="color:#999;padding:1rem;">Nog geen rooster voor deze week. Klik op "Rooster Genereren".</p>';
        document.getElementById('rooster-stats').innerHTML = '';
        return;
    }

    let html = '<table class="rooster-table"><thead><tr><th>Dienst</th>';
    dates.forEach(d => {
        html += `<th>${getShortDay(d)} ${d.getDate()}/${d.getMonth() + 1}</th>`;
    });
    html += '</tr></thead><tbody>';

    const shiftTypes = [
        { key: 'opener', label: 'Opener', cls: 'shift-opener' },
        { key: 'morning', label: 'Ochtend', cls: 'shift-morning' },
        { key: 'tussen', label: 'Plein', cls: 'shift-tussen' },
        { key: 'closing', label: 'Sluiting', cls: 'shift-closing' },
        { key: 'clean', label: 'Schoonmaak', cls: 'shift-clean' },
        { key: 'maintenance', label: 'Onderhoud', cls: 'shift-maintenance' }
    ];

    shiftTypes.forEach(st => {
        html += `<tr><td><span class="shift-tag ${st.cls}">${st.label}</span></td>`;
        dates.forEach(d => {
            const dateStr = formatDate(d);
            const daySchedule = schedule[dateStr];
            if (!daySchedule) {
                html += '<td>-</td>';
                return;
            }
            const shifts = daySchedule.shifts.filter(s => s.type === st.key);
            if (shifts.length === 0) {
                html += '<td>-</td>';
            } else {
                html += '<td>' + shifts.map((s, idx) => {
                    const shiftIdx = daySchedule.shifts.indexOf(s);
                    return `<div class="shift-cell" data-date="${dateStr}" data-shift-idx="${shiftIdx}">${s.name}<br><small>${s.start}-${s.end}</small></div>`;
                }).join('') + '</td>';
            }
        });
        html += '</tr>';
    });

    // Warnings row
    html += '<tr><td><strong>Status</strong></td>';
    dates.forEach(d => {
        const dateStr = formatDate(d);
        const daySchedule = schedule[dateStr];
        if (daySchedule && daySchedule.warning) {
            html += `<td style="color:#dc3545;font-size:0.8rem;">${daySchedule.warning}</td>`;
        } else {
            html += '<td style="color:#28a745;">✓</td>';
        }
    });
    html += '</tr>';

    html += '</tbody></table>';
    grid.innerHTML = html;

    // Stats
    const weekHours = {};
    employees.forEach(e => { weekHours[e.id] = 0; });
    Object.values(schedule).forEach(day => {
        if (!day.shifts) return;
        day.shifts.forEach(s => {
            weekHours[s.employeeId] = (weekHours[s.employeeId] || 0) + s.hours;
        });
    });

    let statsHtml = '<h3>Uren overzicht deze week</h3><div class="stats-grid">';
    employees.forEach(emp => {
        const hours = (weekHours[emp.id] || 0).toFixed(1);
        const isOver = weekHours[emp.id] > emp.maxHours;
        statsHtml += `<div class="stat-card">
            <div class="stat-name">${emp.name}</div>
            <div class="stat-hours ${isOver ? 'stat-over' : ''}">${hours} / ${emp.maxHours} uur
            ${isOver ? ' ⚠️' : ''}</div>
        </div>`;
    });
    statsHtml += '</div>';
    document.getElementById('rooster-stats').innerHTML = statsHtml;
}

// ============ SHIFT EDITING ============
const shiftTypeToSlot = { opener: 0, morning: 0, tussen: 1, closing: 2, clean: 3, maintenance: 4 };

function getAvailableEmployeesForShift(dateStr, slotIndex, currentEmpId) {
    const parts = dateStr.split('-');
    const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const jsDay = date.getDay();
    const dayKey = jsDay === 0 ? 6 : jsDay - 1;
    const result = [];
    for (const emp of employees) {
        if (emp.id === currentEmpId) continue;
        if (isOnLeave(emp.id, dateStr)) continue;
        const empAvail = availability[emp.id];
        if (!empAvail) continue;
        const status = empAvail[`${dayKey}_${slotIndex}`];
        if (status === 'available' || status === 'preferred') {
            result.push(emp);
        }
    }
    return result;
}

function timeToHours(t) {
    const [h, m] = t.split(':').map(Number);
    return h + m / 60;
}

function openShiftEditor(dateStr, shiftIdx) {
    const dates = getWeekDates(currentWeekOffset);
    const weekKey = formatDate(dates[0]);
    const schedule = schedules[weekKey];
    if (!schedule || !schedule[dateStr]) return;
    const shift = schedule[dateStr].shifts[shiftIdx];
    if (!shift) return;

    const slotIndex = shiftTypeToSlot[shift.type] ?? 0;
    const parts = dateStr.split('-');
    const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const jsDay = date.getDay();
    const dayKey = jsDay === 0 ? 6 : jsDay - 1;

    const availableEmps = [];
    for (const emp of employees) {
        if (emp.id === shift.employeeId) continue;
        if (isOnLeave(emp.id, dateStr)) continue;
        const empAvail = availability[emp.id];
        if (!empAvail) continue;
        const status = (empAvail[`${dayKey}_${slotIndex}`] || '').trim().split(/\s+/)[0];
        if (status === 'available' || status === 'fixed' || status === 'preferred') {
            availableEmps.push(emp);
        }
    }

    const currentEmp = employees.find(e => e.id === shift.employeeId);

    let modal = document.getElementById('shift-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'shift-modal';
        modal.className = 'modal-overlay';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="modal-content">
            <h3>Dienst bewerken</h3>
            <div class="modal-field">
                <label>Medewerker:</label>
                <select id="modal-employee">
                    <option value="${shift.employeeId}" selected>${currentEmp ? currentEmp.name : shift.name}</option>
                    ${availableEmps.map(e => `<option value="${e.id}">${e.name}${e.contract === '0uren' ? ' (0-uren)' : ''}</option>`).join('')}
                </select>
            </div>
            <div class="modal-field">
                <label>Start:</label>
                <input type="time" id="modal-start" value="${shift.start}">
            </div>
            <div class="modal-field">
                <label>Eind:</label>
                <input type="time" id="modal-end" value="${shift.end}">
            </div>
            <div class="modal-actions">
                <button class="btn-primary" id="modal-save">Opslaan</button>
                <button class="btn-secondary" id="modal-cancel">Annuleren</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';

    document.getElementById('modal-cancel').addEventListener('click', () => {
        modal.style.display = 'none';
    });
    modal.addEventListener('click', e => {
        if (e.target === modal) modal.style.display = 'none';
    });

    document.getElementById('modal-save').addEventListener('click', () => {
        const newEmpId = document.getElementById('modal-employee').value;
        const newStart = document.getElementById('modal-start').value;
        const newEnd = document.getElementById('modal-end').value;

        if (!newStart || !newEnd) { toast('Vul start en eindtijd in'); return; }
        if (newStart >= newEnd) { toast('Eindtijd moet na starttijd zijn'); return; }

        const newEmp = employees.find(e => e.id === newEmpId);
        shift.employeeId = newEmpId;
        shift.name = newEmp ? newEmp.name : shift.name;
        shift.start = newStart;
        shift.end = newEnd;
        shift.hours = timeToHours(newEnd) - timeToHours(newStart) - settings.breakMinutes / 60;

        save();
        modal.style.display = 'none';
        renderRooster();
        toast('Dienst bijgewerkt');
    });
}

document.getElementById('rooster-grid').addEventListener('click', e => {
    const cell = e.target.closest('.shift-cell');
    if (!cell) return;
    openShiftEditor(cell.dataset.date, parseInt(cell.dataset.shiftIdx));
});

// ============ ROOSTER CONTROLS ============
document.getElementById('prev-week').addEventListener('click', () => {
    currentWeekOffset--;
    renderRooster();
});

document.getElementById('next-week').addEventListener('click', () => {
    currentWeekOffset++;
    renderRooster();
});

document.getElementById('generate-btn').addEventListener('click', () => {
    if (employees.length === 0) {
        toast('Voeg eerst medewerkers toe');
        return;
    }
    generateSchedule(currentWeekOffset);
    renderRooster();
    toast('Rooster gegenereerd!');
});

// ============ SETTINGS ============
document.getElementById('save-settings').addEventListener('click', () => {
    settings.minMorning = parseInt(document.getElementById('set-min-morning').value) || 2;
    settings.minClosing = parseInt(document.getElementById('set-min-closing').value) || 2;
    settings.mondayClean = document.getElementById('set-monday-clean').checked;
    settings.mondayCleanMin = parseInt(document.getElementById('set-monday-clean-min').value) || 2;
    settings.wednesdayMaint = document.getElementById('set-wednesday-maint').checked;
    settings.wedTechMin = parseInt(document.getElementById('set-wed-tech-min').value) || 1;
    settings.wedCleanMin = parseInt(document.getElementById('set-wed-clean-min').value) || 1;
    settings.breakMinutes = parseInt(document.getElementById('set-break').value) || 30;
    save();
    toast('Instellingen opgeslagen');
});

function loadSettings() {
    document.getElementById('set-min-morning').value = settings.minMorning;
    document.getElementById('set-min-closing').value = settings.minClosing;
    document.getElementById('set-monday-clean').checked = settings.mondayClean;
    document.getElementById('set-monday-clean-min').value = settings.mondayCleanMin || 2;
    document.getElementById('set-wednesday-maint').checked = settings.wednesdayMaint;
    document.getElementById('set-wed-tech-min').value = settings.wedTechMin || 1;
    document.getElementById('set-wed-clean-min').value = settings.wedCleanMin || 1;
    document.getElementById('set-break').value = settings.breakMinutes;
}

// ============ EXPORT / IMPORT ============
document.getElementById('export-data').addEventListener('click', () => {
    const data = { employees, availability, leaves, schedules, settings, kassaTransactions };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wasstraat-rooster-${formatDate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Data geëxporteerd');
});

document.getElementById('import-data').addEventListener('click', () => {
    document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        try {
            const data = JSON.parse(ev.target.result);
            if (data.employees) employees = data.employees;
            if (data.availability) availability = data.availability;
            if (data.leaves) leaves = data.leaves;
            if (data.schedules) schedules = data.schedules;
            if (data.settings) settings = data.settings;
            if (data.kassaTransactions) kassaTransactions = data.kassaTransactions;
            save();
            renderKassa();
            renderEmployees();
            updateEmployeeSelects();
            loadSettings();
            renderRooster();
            toast('Data geïmporteerd');
        } catch {
            toast('Ongeldig bestand');
        }
    };
    reader.readAsText(file);
});

// ============ KASSA ============
let kassaTransactions = Store.get('kassaTransactions', {});
let kassaDayOffset = 0;

const PROGRAMS = [
    { id: 'normaal', name: 'Normaal' },
    { id: 'intensief', name: 'Intensief' },
    { id: 'proteqt', name: 'Proteqt' }
];

function getKassaDate(offset) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d;
}

function getKassaDateKey(offset) {
    return formatDate(getKassaDate(offset));
}

function getKassaDayTransactions(offset) {
    const key = getKassaDateKey(offset);
    return kassaTransactions[key] || [];
}

function addKassaTransaction(program) {
    const key = getKassaDateKey(kassaDayOffset);
    if (!kassaTransactions[key]) kassaTransactions[key] = [];
    kassaTransactions[key].push({
        id: generateId(),
        program: program,
        time: new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    });
    Store.set('kassaTransactions', kassaTransactions);
    syncToCloud();
    renderKassa();
}

function removeKassaTransaction(id) {
    const key = getKassaDateKey(kassaDayOffset);
    if (!kassaTransactions[key]) return;
    kassaTransactions[key] = kassaTransactions[key].filter(t => t.id !== id);
    if (kassaTransactions[key].length === 0) delete kassaTransactions[key];
    Store.set('kassaTransactions', kassaTransactions);
    syncToCloud();
    renderKassa();
}

function clearKassaDay() {
    const key = getKassaDateKey(kassaDayOffset);
    const date = getKassaDate(kassaDayOffset);
    const label = kassaDayOffset === 0 ? 'vandaag' : formatDateNL(date);
    if (!confirm(`Alle registraties van ${label} wissen?`)) return;
    delete kassaTransactions[key];
    Store.set('kassaTransactions', kassaTransactions);
    syncToCloud();
    renderKassa();
    toast('Dag gewist');
}

function formatDateNL(d) {
    const days = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
    const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function renderKassa() {
    const date = getKassaDate(kassaDayOffset);
    const transactions = getKassaDayTransactions(kassaDayOffset);

    const dateLabel = document.getElementById('kassa-date-label');
    if (kassaDayOffset === 0) {
        dateLabel.textContent = `Vandaag - ${formatDateNL(date)}`;
    } else if (kassaDayOffset === -1) {
        dateLabel.textContent = `Gisteren - ${formatDateNL(date)}`;
    } else {
        dateLabel.textContent = formatDateNL(date);
    }

    const total = transactions.length;
    const counts = { normaal: 0, intensief: 0, proteqt: 0 };
    transactions.forEach(t => { counts[t.program] = (counts[t.program] || 0) + 1; });

    document.getElementById('kassa-total-count').textContent = total;
    document.getElementById('count-normaal').textContent = counts.normaal;
    document.getElementById('count-intensief').textContent = counts.intensief;
    document.getElementById('count-proteqt').textContent = counts.proteqt;

    renderKassaBarChart(counts, total);
    renderKassaWeekGrid();
    renderKassaTransactions(transactions);
}

function renderKassaBarChart(counts, total) {
    const chart = document.getElementById('kassa-bar-chart');
    const maxCount = Math.max(counts.normaal, counts.intensief, counts.proteqt, 1);

    chart.innerHTML = PROGRAMS.map(p => {
        const count = counts[p.id] || 0;
        const pct = (count / maxCount) * 100;
        const height = Math.max(pct, 4);
        return `
            <div class="kassa-bar-wrapper">
                <div class="kassa-bar bar-${p.id}" style="height: ${height}%">
                    <span class="kassa-bar-value">${count}</span>
                </div>
                <span class="kassa-bar-label">${p.name}</span>
            </div>
        `;
    }).join('');
}

function renderKassaWeekGrid() {
    const grid = document.getElementById('kassa-week-grid');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const jsDay = today.getDay();
    const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay;

    const dayNames = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
    let html = '';

    for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + mondayOffset + i);
        const key = formatDate(d);
        const dayTransactions = kassaTransactions[key] || [];
        const count = dayTransactions.length;
        const isToday = formatDate(d) === formatDate(today);

        html += `
            <div class="kassa-week-day ${isToday ? 'today' : ''}">
                <div class="week-day-name">${dayNames[i]}</div>
                <div class="week-day-count">${count}</div>
                <div class="week-day-date">${d.getDate()}/${d.getMonth() + 1}</div>
            </div>
        `;
    }

    grid.innerHTML = html;
}

function renderKassaTransactions(transactions) {
    const list = document.getElementById('kassa-transaction-list');

    if (transactions.length === 0) {
        list.innerHTML = '<p style="color:#999;padding:1rem;text-align:center;">Nog geen registraties voor deze dag.</p>';
        return;
    }

    const reversed = [...transactions].reverse();
    list.innerHTML = reversed.map(t => {
        const prog = PROGRAMS.find(p => p.id === t.program);
        return `
            <div class="kassa-transaction">
                <span class="transaction-dot dot-${t.program}"></span>
                <span class="transaction-program">${prog ? prog.name : t.program}</span>
                <span class="transaction-time">${t.time}</span>
                <button class="transaction-delete" data-id="${t.id}" title="Verwijderen">&times;</button>
            </div>
        `;
    }).join('');
}

document.querySelectorAll('.kassa-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        addKassaTransaction(btn.dataset.program);
        toast(`${btn.dataset.program.charAt(0).toUpperCase() + btn.dataset.program.slice(1)} +1`);
    });
});

document.getElementById('kassa-transaction-list').addEventListener('click', e => {
    const btn = e.target.closest('.transaction-delete');
    if (!btn) return;
    removeKassaTransaction(btn.dataset.id);
});

document.getElementById('kassa-prev-day').addEventListener('click', () => {
    kassaDayOffset--;
    renderKassa();
});

document.getElementById('kassa-next-day').addEventListener('click', () => {
    kassaDayOffset++;
    renderKassa();
});

document.getElementById('kassa-today-btn').addEventListener('click', () => {
    kassaDayOffset = 0;
    renderKassa();
});

document.getElementById('kassa-clear-day').addEventListener('click', clearKassaDay);

// ============ INIT ============
renderKassa();
renderEmployees();
updateEmployeeSelects();
loadSettings();
renderRooster();
loadFromCloud();
