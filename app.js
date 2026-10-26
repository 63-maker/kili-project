/**
 * பணக் காவலன்
 * Plain HTML + JS. No build step, no npm, no bundler — open index.html
 * through any static file server, or deploy the folder as-is.
 *
 * ── SET UP (do this before deploying) ────────────────────────────────────
 * 1. Go to your Supabase project → Project Settings → API.
 * 2. Copy the "Project URL" and the "anon / public" key.
 * 3. Paste them into the two constants directly below.
 *
 * The anon key is meant to be public — Supabase's own docs call it safe to
 * ship in client-side code. It is not a secret, and hiding it here would not
 * add protection. What actually protects your data is Row Level Security
 * (RLS) policies on your tables. Never put your service_role key here —
 * that one IS secret and must never appear in code that reaches a browser.
 *
 * ── DEPLOYING ─────────────────────────────────────────────────────────────
 * Local: double-click index.html, or serve the folder with any static
 *        server (e.g. `python3 -m http.server`). No install step needed.
 * Netlify: drag the whole project folder onto https://app.netlify.com/drop
 *          — or connect the repo with the build command left EMPTY and the
 *          publish directory set to the project root ("/" or ".").
 * Vercel: connect the repo, set Framework Preset to "Other", leave the
 *         build command empty, and set the output directory to "./".
 * Either way there's nothing to build — these are the exact files served.
 * ──────────────────────────────────────────────────────────────────────────
 */

const SUPABASE_URL = 'https://raiadiycyqeqqaamibqe.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RYPeFrUwfkPZ66ogV1HE6g_pt0U9Dlc';

let sb = null;
let configError = null;

const looksUnset = !SUPABASE_URL || !SUPABASE_ANON_KEY ||
    SUPABASE_URL.includes('your-project-ref') || SUPABASE_ANON_KEY.includes('your-anon-key');

if (looksUnset) {
    configError = 'SUPABASE_URL / SUPABASE_ANON_KEY still have their placeholder values.';
    console.error('[config] Edit SUPABASE_URL and SUPABASE_ANON_KEY at the top of app.js, then redeploy.');
} else if (typeof window.supabase === 'undefined') {
    configError = 'The Supabase script tag did not load.';
    console.error('[config] window.supabase is undefined — check the <script src="...supabase-js@2"> tag in index.html and your network connection.');
} else {
    try {
        sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { persistSession: false },
        });
    } catch (err) {
        configError = err.message;
        console.error('[config] Could not create the Supabase client:', err);
    }
}

// ── App state (in memory only) ───────────────────────────────────────────────

const DEFAULT_THEME = 'obsidian';

let currentUser = null;
let currentTheme = DEFAULT_THEME;
let userSpendingChart = null;
let categoryChart = null;
let allExpenses = [];
let allNotes = [];
let realtimeChannel = null;

// ── Theme engine ─────────────────────────────────────────────────────────────
// The chosen theme is stored on the user's row in Supabase, so it follows the
// account across devices. Requires a `theme` column on public.users:
//   ALTER TABLE public.users ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'obsidian';
// Without that column the theme still works, it just resets on logout.

const THEMES = {
    obsidian:  { name: 'Obsidian Gold', primary: '#f59e0b', text: '#e8e6e3', grid: '#2a2f42' },
    emerald:   { name: 'Emerald Royal', primary: '#10b981', text: '#e0ede8', grid: '#1e3a32' },
    cyberpunk: { name: 'Nebula Violet', primary: '#818cf8', text: '#e4e0f3', grid: '#2e2660' },
    nordic:    { name: 'Nordic Frost',  primary: '#38bdf8', text: '#dbe5f0', grid: '#233350' },
};

function setTheme(themeKey, { notify = true, persist = true } = {}) {
    if (!THEMES[themeKey]) themeKey = DEFAULT_THEME;
    currentTheme = themeKey;

    document.documentElement.setAttribute('data-theme', themeKey);

    const label = document.getElementById('currentThemeLabel');
    if (label) label.textContent = THEMES[themeKey].name.split(' ')[0];

    document.querySelectorAll('.theme-option').forEach(opt => {
        opt.classList.toggle('active-theme', opt.getAttribute('data-theme-id') === themeKey);
    });

    closeThemeDropdown();
    if (notify) showToast(`Theme set to ${THEMES[themeKey].name}`, 'info');
    if (userSpendingChart || categoryChart) renderCharts(allExpenses);
    if (persist) saveThemePreference(themeKey);
}

async function saveThemePreference(themeKey) {
    if (!sb || !currentUser) return;
    const { error } = await sb.from('users').update({ theme: themeKey }).eq('id', currentUser.id);
    if (error) {
        // Most likely the optional `theme` column is missing. Not fatal.
        console.warn('[theme] Preference not saved:', error.message);
        return;
    }
    currentUser.theme = themeKey;
}

function toggleThemeDropdown() {
    document.getElementById('themeMenu')?.classList.toggle('hidden');
}

function closeThemeDropdown() {
    document.getElementById('themeMenu')?.classList.add('hidden');
}

document.addEventListener('click', e => {
    const wrap = document.querySelector('.theme-dropdown-wrap');
    if (wrap && !wrap.contains(e.target)) closeThemeDropdown();
});

// ── Authentication ───────────────────────────────────────────────────────────

async function handleLogin(e) {
    e.preventDefault();
    if (!sb) { showConfigError(); return; }

    const username = document.getElementById('loginUsername').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value;

    const btn = document.getElementById('loginSubmitBtn');
    const btnLabel = btn.querySelector('span');
    btn.disabled = true;
    btnLabel.textContent = 'Logging in…';

    try {
        const { data, error } = await sb
            .from('users')
            .select('*')
            .eq('username', username)
            .eq('password', password)
            .limit(1)
            .single();

        if (error || !data) {
            showError(document.getElementById('loginError'), 'That username and password do not match an account.');
            return;
        }

        loginSuccess(data);
    } catch (err) {
        showError(document.getElementById('loginError'), `Could not reach the database: ${err.message}`);
    } finally {
        btn.disabled = false;
        btnLabel.textContent = 'Log in';
    }
}

function loginSuccess(user) {
    currentUser = user;

    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');

    const avatar = document.getElementById('userAvatar');
    const nameEl = document.getElementById('userDisplayName');
    const roleEl = document.getElementById('userRoleBadge');
    if (avatar) avatar.textContent = user.username.charAt(0).toUpperCase();
    if (nameEl) nameEl.textContent = user.username;
    if (roleEl) roleEl.textContent = user.role.toUpperCase();

    const isAdmin = user.role === 'admin';
    ['usersLinkDesktop', 'usersLinkMobile'].forEach(id => {
        document.getElementById(id)?.classList.toggle('hidden', !isAdmin);
    });

    // Apply the theme saved against this account, if the column exists.
    setTheme(user.theme || DEFAULT_THEME, { notify: false, persist: false });

    showToast(`Welcome back, ${capitalize(user.username)}`, 'success');
    loadApp();
    setupRealtimeSync();
}

function logout() {
    if (realtimeChannel && sb) sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
    currentUser = null;
    allExpenses = [];
    allNotes = [];

    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';

    setTheme(DEFAULT_THEME, { notify: false, persist: false });
    showSection('expenses');
    showToast('Logged out', 'info');
}

// ── Real-time sync ───────────────────────────────────────────────────────────

function setupRealtimeSync() {
    if (!sb || realtimeChannel) return;
    realtimeChannel = sb
        .channel('pk-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => {
            displayExpenses();
            displayBalances();
            displaySummary();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, () => {
            displayNotes();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
            updatePeopleDropdowns();
            if (currentUser?.role === 'admin') displayUsers();
        })
        .subscribe();
}

// ── Main app ─────────────────────────────────────────────────────────────────

async function loadApp() {
    await Promise.all([
        updatePeopleDropdowns(),
        displayExpenses(),
        displayNotes(),
    ]);
    displayBalances();
    displaySummary();
    if (currentUser?.role === 'admin') displayUsers();
}

async function updatePeopleDropdowns() {
    const { data: users } = await sb.from('users').select('username, role').order('username');
    const paidBySelect = document.getElementById('paidBy');
    const participantsList = document.getElementById('participantsList');
    if (!paidBySelect || !participantsList) return;

    paidBySelect.innerHTML = '<option value="">Choose who paid</option>';
    participantsList.innerHTML = '';

    (users || []).forEach(user => {
        const opt = document.createElement('option');
        opt.value = user.username;
        opt.textContent = capitalize(user.username) + (user.username === currentUser?.username ? ' (you)' : '');
        paidBySelect.appendChild(opt);

        const lbl = document.createElement('label');
        lbl.className = 'participant-item';
        lbl.innerHTML = `
            <input type="checkbox" id="part-${user.username}" value="${user.username}" checked>
            <span>${capitalize(user.username)}</span>
        `;
        participantsList.appendChild(lbl);
    });

    if (currentUser) paidBySelect.value = currentUser.username;
}

function toggleSelectAllParticipants(checkAll) {
    document.querySelectorAll('#participantsList input[type="checkbox"]').forEach(cb => cb.checked = checkAll);
}

// ── Expenses ─────────────────────────────────────────────────────────────────

async function handleAddExpense(e) {
    e.preventDefault();
    const description = document.getElementById('expenseDescription').value.trim();
    const amount = parseFloat(document.getElementById('expenseAmount').value);
    const category = document.getElementById('expenseCategory').value;
    const paid_by = document.getElementById('paidBy').value;
    const participants = Array.from(document.querySelectorAll('#participantsList input:checked')).map(cb => cb.value);

    if (!description || isNaN(amount) || amount <= 0 || !paid_by) {
        showError(document.getElementById('expenseError'), 'Add a description, an amount above zero, and who paid.');
        return;
    }
    if (participants.length === 0) {
        showError(document.getElementById('expenseError'), 'Pick at least one person to split between.');
        return;
    }

    const btn = document.getElementById('addExpenseBtn');
    btn.disabled = true;

    const { error } = await sb.from('expenses').insert({
        description, amount, category, paid_by, participants, date: new Date().toISOString(),
    });

    btn.disabled = false;

    if (error) {
        showError(document.getElementById('expenseError'), `Could not save the expense: ${error.message}`);
        return;
    }

    document.getElementById('expenseDescription').value = '';
    document.getElementById('expenseAmount').value = '';
    showToast(`Added ₹${amount.toFixed(2)} for ${description}`, 'success');
    showSuccess(document.getElementById('expenseSuccess'), 'Expense added.');

    // Realtime also refreshes these, but do it now so the UI responds instantly.
    displayExpenses();
    displayBalances();
    displaySummary();
}

async function displayExpenses() {
    const list = document.getElementById('expensesList');
    if (!list) return;
    list.innerHTML = '<div class="loading"><div class="spinner"></div><span>Loading expenses</span></div>';

    const { data, error } = await sb.from('expenses').select('*').order('date', { ascending: false }).limit(50);
    if (error) {
        list.innerHTML = `<p class="loading" style="color:var(--danger-color)">Could not load expenses: ${escapeHtml(error.message)}</p>`;
        return;
    }

    allExpenses = data || [];

    if (allExpenses.length === 0) {
        list.innerHTML = '<p class="loading">No expenses yet. Add the first one.</p>';
        return;
    }
    renderExpenseItems(allExpenses);
}

function renderExpenseItems(items) {
    const list = document.getElementById('expensesList');
    if (!list) return;
    const isAdmin = currentUser?.role === 'admin';

    if (!items.length) { list.innerHTML = '<p class="loading">No expenses match that search.</p>'; return; }

    list.innerHTML = items.map(exp => {
        const canDelete = isAdmin || currentUser?.username === exp.paid_by;
        const date = new Date(exp.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        const parts = Array.isArray(exp.participants) ? exp.participants : [];
        const perPerson = (parseFloat(exp.amount) / (parts.length || 1)).toFixed(2);
        return `
            <div class="expense-item">
                <div class="expense-header">
                    <div>
                        <span class="expense-title">${escapeHtml(exp.description)}</span>
                        ${exp.category ? `<span class="expense-category-pill">${escapeHtml(exp.category)}</span>` : ''}
                    </div>
                    <span class="expense-amount">₹${parseFloat(exp.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                <div class="expense-meta">Paid by <strong style="text-transform:capitalize">${escapeHtml(exp.paid_by)}</strong> • ${date} • ₹${perPerson}/member</div>
                <div class="expense-participants"><strong>Split (${parts.length}):</strong> ${parts.map(p => escapeHtml(capitalize(p))).join(', ')}</div>
                ${canDelete ? `<div style="margin-top:12px;display:flex;justify-content:flex-end"><button onclick="deleteExpense(${exp.id})" class="btn-danger btn-sm">🗑️ Delete</button></div>` : ''}
            </div>`;
    }).join('');
}

function filterExpenses() {
    const q = document.getElementById('expenseSearch').value.toLowerCase();
    if (!q) { renderExpenseItems(allExpenses); return; }
    renderExpenseItems(allExpenses.filter(e =>
        e.description.toLowerCase().includes(q) ||
        e.paid_by.toLowerCase().includes(q) ||
        (e.category && e.category.toLowerCase().includes(q)) ||
        (Array.isArray(e.participants) && e.participants.some(p => p.toLowerCase().includes(q)))
    ));
}

async function deleteExpense(id) {
    if (!confirm('Delete this expense?')) return;
    const { error } = await sb.from('expenses').delete().eq('id', id);
    if (error) { showToast(`Could not delete: ${error.message}`, 'error'); return; }
    showToast('Expense deleted', 'info');
    displayExpenses();
    displayBalances();
    displaySummary();
}

function exportExpensesCSV() {
    if (!allExpenses.length) { showToast('There are no expenses to export', 'info'); return; }
    let csv = 'data:text/csv;charset=utf-8,ID,Date,Description,Category,Amount,Paid By,Participants\n';
    allExpenses.forEach(e => {
        csv += [
            e.id,
            `"${new Date(e.date).toISOString().split('T')[0]}"`,
            `"${(e.description || '').replace(/"/g, '""')}"`,
            `"${e.category || ''}"`,
            e.amount,
            `"${e.paid_by}"`,
            `"${(Array.isArray(e.participants) ? e.participants : []).join(';')}"`,
        ].join(',') + '\n';
    });
    const a = document.createElement('a');
    a.href = encodeURI(csv);
    a.download = `panak_kaavalan_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    showToast('CSV exported', 'success');
}

// ── Balances & settlements ───────────────────────────────────────────────────

function calculateBalances() {
    const balances = {};
    allExpenses.forEach(exp => {
        const amount = parseFloat(exp.amount);
        const parts = Array.isArray(exp.participants) ? exp.participants : [];
        if (!parts.length) return;
        const share = amount / parts.length;
        if (!(exp.paid_by in balances)) balances[exp.paid_by] = 0;
        parts.forEach(p => {
            if (!(p in balances)) balances[p] = 0;
            if (p !== exp.paid_by) {
                balances[p] -= share;
                balances[exp.paid_by] += share;
            }
        });
    });
    return balances;
}

async function displayBalances() {
    const list = document.getElementById('balancesList');
    if (!list) return;

    // Seed the map with every member so people at zero still show up.
    const { data: users } = await sb.from('users').select('username');
    const balances = {};
    (users || []).forEach(u => balances[u.username] = 0);
    Object.assign(balances, calculateBalances());

    const entries = Object.entries(balances).sort((a, b) => b[1] - a[1]);
    if (!entries.length) { list.innerHTML = '<p class="loading">Nothing to balance yet.</p>'; displaySettlements({}); return; }

    list.innerHTML = `<div class="balance-card-grid">${entries.map(([user, amt]) => {
        const pos = amt > 0.01, neg = amt < -0.01;
        return `<div class="balance-item-wrap">
            <div class="balance-user">${escapeHtml(capitalize(user))}</div>
            <div class="${pos ? 'balance-status-positive' : neg ? 'balance-status-negative' : 'balance-status-zero'}">
                ${pos ? `+ ₹${amt.toFixed(2)}` : neg ? `- ₹${Math.abs(amt).toFixed(2)}` : 'Settled'}
            </div>
            <div style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;margin-top:4px;font-weight:600">${pos ? 'Receives' : neg ? 'Owes' : 'All clear'}</div>
        </div>`;
    }).join('')}</div>`;

    displaySettlements(balances);
}

function displaySettlements(balances) {
    const list = document.getElementById('settlementsList');
    if (!list) return;
    const creditors = [], debtors = [];
    Object.entries(balances).forEach(([p, a]) => {
        if (a > 0.01) creditors.push({ person: p, amount: a });
        else if (a < -0.01) debtors.push({ person: p, amount: Math.abs(a) });
    });
    creditors.sort((a, b) => b.amount - a.amount);
    debtors.sort((a, b) => b.amount - a.amount);

    const settlements = [];
    const cC = creditors.map(c => ({ ...c })), dC = debtors.map(d => ({ ...d }));
    let i = 0, j = 0;
    while (i < cC.length && j < dC.length) {
        const sa = Math.min(cC[i].amount, dC[j].amount);
        if (sa > 0.01) settlements.push({ from: dC[j].person, to: cC[i].person, amount: sa });
        cC[i].amount -= sa; dC[j].amount -= sa;
        if (cC[i].amount < 0.01) i++;
        if (dC[j].amount < 0.01) j++;
    }

    if (!settlements.length) {
        list.innerHTML = `<div style="text-align:center;padding:24px"><div style="font-size:2.2rem;margin-bottom:8px">🎉</div><h3 style="color:var(--success-color);font-weight:700">All settled</h3><p style="color:var(--text-muted);font-size:0.85rem;margin-top:4px">Nobody owes anybody.</p></div>`;
        return;
    }

    list.innerHTML = settlements.map((s, idx) => `
        <div class="settlement-card">
            <div class="settlement-flow">
                <span class="settle-from">${escapeHtml(capitalize(s.from))}</span>
                <span class="settle-arrow">➔ pays ➔</span>
                <span class="settle-to">${escapeHtml(capitalize(s.to))}</span>
            </div>
            <div class="settle-amount">₹${s.amount.toFixed(2)}</div>
            <div class="settle-action-row">
                <input type="number" id="settle-amt-${idx}" class="settle-input" value="${s.amount.toFixed(2)}" max="${s.amount.toFixed(2)}" min="0.01" step="0.01">
                <button onclick="handleSettlePayment('${escapeHtml(s.from)}','${escapeHtml(s.to)}',${idx})" class="btn-success">✅ Record settlement</button>
            </div>
        </div>`).join('');
}

async function handleSettlePayment(from, to, idx) {
    const amount = parseFloat(document.getElementById(`settle-amt-${idx}`).value);
    if (isNaN(amount) || amount <= 0) { showToast('Enter an amount above zero', 'error'); return; }
    if (!confirm(`Record ₹${amount.toFixed(2)} from ${capitalize(from)} to ${capitalize(to)}?`)) return;

    const { error } = await sb.from('expenses').insert({
        description: `Settlement: ${capitalize(from)} ➔ ${capitalize(to)}`,
        amount, category: 'Settlement', paid_by: from, participants: [to], date: new Date().toISOString(),
    });

    if (error) { showToast(`Could not record the settlement: ${error.message}`, 'error'); return; }
    showToast(`Recorded ₹${amount.toFixed(2)}`, 'success');
    displayExpenses(); displayBalances(); displaySummary();
}

// ── Summary & charts ─────────────────────────────────────────────────────────

async function displaySummary() {
    const summaryEl = document.getElementById('summaryDetails');
    if (!summaryEl) return;

    const expenses = allExpenses.length ? allExpenses : (await sb.from('expenses').select('*')).data || [];
    allExpenses = expenses;

    const total = expenses.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    const count = expenses.length;
    const avg = count ? total / count : 0;
    const settlements = expenses.filter(e => e.category === 'Settlement').length;

    summaryEl.innerHTML = `
        <div class="stat-grid">
            <div class="stat-card"><div class="stat-value">₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div><div class="stat-label">Total spend</div></div>
            <div class="stat-card"><div class="stat-value">${count}</div><div class="stat-label">Transactions</div></div>
            <div class="stat-card"><div class="stat-value">₹${avg.toFixed(2)}</div><div class="stat-label">Average</div></div>
            <div class="stat-card"><div class="stat-value">${settlements}</div><div class="stat-label">Settled dues</div></div>
        </div>`;

    renderCharts(expenses);
}

function renderCharts(expenses) {
    if (typeof Chart === 'undefined') return;
    const { primary, text, grid } = THEMES[currentTheme] || THEMES[DEFAULT_THEME];

    const userSpending = {};
    const categorySpending = {};
    expenses.forEach(e => {
        if (e.category === 'Settlement') return;
        userSpending[e.paid_by] = (userSpending[e.paid_by] || 0) + parseFloat(e.amount || 0);
        const cat = e.category || 'Other';
        categorySpending[cat] = (categorySpending[cat] || 0) + parseFloat(e.amount || 0);
    });

    const userCtx = document.getElementById('userSpendingChart');
    if (userCtx) {
        if (userSpendingChart) userSpendingChart.destroy();
        userSpendingChart = new Chart(userCtx, {
            type: 'bar',
            data: {
                labels: Object.keys(userSpending).map(capitalize),
                datasets: [{ label: 'Paid (₹)', data: Object.values(userSpending), backgroundColor: primary, borderRadius: 8, borderSkipped: false }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { backgroundColor: '#111827', titleColor: '#f9fafb', bodyColor: '#f3f4f6', borderColor: primary, borderWidth: 1, padding: 10, displayColors: false, callbacks: { label: ctx => ` ₹${parseFloat(ctx.parsed.y).toFixed(2)}` } },
                },
                scales: { x: { grid: { display: false }, ticks: { color: text } }, y: { grid: { color: grid }, ticks: { color: text } } },
            },
        });
    }

    const catCtx = document.getElementById('categoryChart');
    if (catCtx) {
        if (categoryChart) categoryChart.destroy();
        const palette = [primary, '#34d399', '#60a5fa', '#f472b6', '#a78bfa', '#fb923c', '#2dd4bf', '#94a3b8'];
        const hasData = Object.keys(categorySpending).length > 0;
        categoryChart = new Chart(catCtx, {
            type: 'doughnut',
            data: {
                labels: hasData ? Object.keys(categorySpending) : ['No data'],
                datasets: [{ data: hasData ? Object.values(categorySpending) : [1], backgroundColor: palette, borderWidth: 0, hoverOffset: 6 }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { color: text, font: { size: 11, weight: '600' }, padding: 12 } },
                    tooltip: { backgroundColor: '#111827', titleColor: '#f9fafb', bodyColor: '#f3f4f6', borderColor: primary, borderWidth: 1, padding: 10 },
                },
                cutout: '72%',
            },
        });
    }
}

// ── Notes ────────────────────────────────────────────────────────────────────

async function handleAddNote(e) {
    e.preventDefault();
    const title = document.getElementById('noteTitle').value.trim();
    const content = document.getElementById('noteContent').value.trim();
    if (!title || !content) { showError(document.getElementById('noteError'), 'Add a title and a note.'); return; }

    const btn = document.getElementById('addNoteBtn');
    btn.disabled = true;

    const now = new Date().toISOString();
    const { error } = await sb.from('notes').insert({
        title, content, author: currentUser.username, created_at: now, updated_at: now,
    });

    btn.disabled = false;

    if (error) { showError(document.getElementById('noteError'), `Could not post the note: ${error.message}`); return; }

    document.getElementById('noteTitle').value = '';
    document.getElementById('noteContent').value = '';
    showToast('Note posted', 'success');
    showSuccess(document.getElementById('noteSuccess'), 'Note posted.');
    displayNotes();
}

async function displayNotes() {
    const list = document.getElementById('notesList');
    if (!list) return;
    list.innerHTML = '<div class="loading"><div class="spinner"></div><span>Loading notes</span></div>';

    const { data, error } = await sb.from('notes').select('*').order('created_at', { ascending: false });
    if (error) {
        list.innerHTML = `<p class="loading" style="color:var(--danger-color)">Could not load notes: ${escapeHtml(error.message)}</p>`;
        return;
    }

    allNotes = data || [];
    renderNotesList(allNotes);
}

function renderNotesList(notes) {
    const list = document.getElementById('notesList');
    if (!list) return;
    if (!notes.length) { list.innerHTML = '<p class="loading">No notes yet. Post the first one.</p>'; return; }

    list.innerHTML = notes.map(note => {
        const canManage = currentUser?.role === 'admin' || currentUser?.username === note.author;
        const date = new Date(note.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
        return `
            <div class="note-item" id="note-item-${note.id}">
                <div class="note-display" id="note-display-${note.id}">
                    <div class="note-header">
                        <span class="note-author">✍️ ${escapeHtml(note.author)}</span>
                        <span class="note-date">${date}</span>
                    </div>
                    <h3 class="note-title">${escapeHtml(note.title)}</h3>
                    <div class="note-content">${escapeHtml(note.content)}</div>
                    ${canManage ? `<div class="note-actions">
                        <button onclick="startEditNote(${note.id})" class="btn-edit">✏️ Edit</button>
                        <button onclick="deleteNote(${note.id})" class="btn-danger btn-sm">🗑️ Delete</button>
                    </div>` : ''}
                </div>
                <div class="note-edit-form" id="note-edit-${note.id}">
                    <div class="form-group"><label>Title</label><input type="text" id="edit-title-${note.id}" value="${escapeHtml(note.title)}"></div>
                    <div class="form-group"><label>Note</label><textarea id="edit-content-${note.id}" rows="4">${escapeHtml(note.content)}</textarea></div>
                    <div style="display:flex;gap:8px;margin-top:10px">
                        <button onclick="saveEditNote(${note.id})" class="btn-success">💾 Save</button>
                        <button onclick="cancelEditNote(${note.id})" class="btn-danger btn-sm">✖️ Cancel</button>
                    </div>
                </div>
            </div>`;
    }).join('');
}

function filterNotes() {
    const q = document.getElementById('noteSearch').value.toLowerCase();
    if (!q) { renderNotesList(allNotes); return; }
    renderNotesList(allNotes.filter(n =>
        n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || n.author.toLowerCase().includes(q)
    ));
}

function startEditNote(id) {
    document.getElementById(`note-display-${id}`)?.classList.add('hidden');
    document.getElementById(`note-edit-${id}`)?.classList.add('active');
}

function cancelEditNote(id) {
    document.getElementById(`note-display-${id}`)?.classList.remove('hidden');
    document.getElementById(`note-edit-${id}`)?.classList.remove('active');
}

async function saveEditNote(id) {
    const title = document.getElementById(`edit-title-${id}`).value.trim();
    const content = document.getElementById(`edit-content-${id}`).value.trim();
    if (!title || !content) { showToast('A note needs both a title and content', 'error'); return; }

    const { error } = await sb.from('notes').update({ title, content, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { showToast(`Could not update the note: ${error.message}`, 'error'); return; }
    showToast('Note updated', 'success');
    displayNotes();
}

async function deleteNote(id) {
    if (!confirm('Delete this note?')) return;
    const { error } = await sb.from('notes').delete().eq('id', id);
    if (error) { showToast(`Could not delete: ${error.message}`, 'error'); return; }
    showToast('Note deleted', 'info');
    displayNotes();
}

// ── User management (admin) ──────────────────────────────────────────────────

async function handleAddUser(e) {
    e.preventDefault();
    const username = document.getElementById('newUsername').value.trim().toLowerCase();
    const password = document.getElementById('newPassword').value;
    const role = document.getElementById('newUserRole').value;
    if (!username || !password) { showError(document.getElementById('userError'), 'Add a username and a password.'); return; }

    const btn = document.getElementById('addUserBtn');
    btn.disabled = true;

    const { error } = await sb.from('users').insert({ username, password, role });

    btn.disabled = false;

    if (error) {
        showError(
            document.getElementById('userError'),
            error.code === '23505' ? 'That username is already taken.' : `Could not add the user: ${error.message}`
        );
        return;
    }

    document.getElementById('newUsername').value = '';
    document.getElementById('newPassword').value = '';
    showToast(`Added ${username}`, 'success');
    showSuccess(document.getElementById('userSuccess'), 'User added.');
    displayUsers();
    updatePeopleDropdowns();
}

async function displayUsers() {
    const list = document.getElementById('usersList');
    if (!list) return;
    list.innerHTML = '<div class="loading"><div class="spinner"></div><span>Loading users</span></div>';

    const { data, error } = await sb.from('users').select('id, username, role').order('username');
    if (error) {
        list.innerHTML = `<p style="color:var(--danger-color)">Could not load users: ${escapeHtml(error.message)}</p>`;
        return;
    }

    list.innerHTML = (data || []).map(u => `
        <div class="user-item">
            <div>
                <strong style="text-transform:capitalize;font-size:1rem">${escapeHtml(u.username)}</strong>
                <span class="role-badge ${u.role === 'admin' ? 'role-admin' : 'role-user'}">${escapeHtml(u.role)}</span>
            </div>
            ${u.username !== 'admin' ? `<button onclick="deleteUser(${u.id},'${escapeHtml(u.username)}')" class="btn-danger btn-sm">🗑️ Delete</button>` : '<span style="font-size:0.75rem;color:var(--text-muted);font-weight:600">Root admin</span>'}
        </div>`).join('');
}

async function deleteUser(id, username) {
    if (username === 'admin') { showToast('The root admin cannot be deleted', 'error'); return; }
    if (!confirm(`Delete ${username}?`)) return;
    const { error } = await sb.from('users').delete().eq('id', id);
    if (error) { showToast(`Could not delete: ${error.message}`, 'error'); return; }
    showToast(`Deleted ${username}`, 'info');
    displayUsers();
    updatePeopleDropdowns();
}

// ── Backup ───────────────────────────────────────────────────────────────────

async function exportFullBackup() {
    const [{ data: users }, { data: expenses }, { data: notes }] = await Promise.all([
        sb.from('users').select('*'),
        sb.from('expenses').select('*'),
        sb.from('notes').select('*'),
    ]);

    const backup = { version: '4.0', exported_at: new Date().toISOString(), users, expenses, notes };
    const a = document.createElement('a');
    a.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(backup, null, 2));
    a.download = `panak_kaavalan_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    showToast('Backup exported', 'success');
}

// ── Navigation & utilities ───────────────────────────────────────────────────

function showSection(sectionId) {
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    document.getElementById(sectionId + '-section')?.classList.add('active');
    document.querySelectorAll('.navbar-link').forEach(link => {
        link.classList.toggle('active', link.getAttribute('onclick')?.includes(sectionId));
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (sectionId === 'summary') setTimeout(displaySummary, 100);
}

function showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 350);
    }, 3500);
}

function showError(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 5000);
}

function showSuccess(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 3500);
}

/** Shown when app.js still has placeholder/broken Supabase credentials. Stays on screen. */
function showConfigError() {
    const el = document.getElementById('loginError');
    if (el) {
        el.textContent = 'This deployment hasn\'t been set up yet. An administrator needs to edit SUPABASE_URL and SUPABASE_ANON_KEY near the top of app.js, then redeploy.';
        el.style.display = 'block';
    }
    document.getElementById('loginSubmitBtn')?.setAttribute('disabled', 'disabled');
    document.getElementById('loginUsername')?.setAttribute('disabled', 'disabled');
    document.getElementById('loginPassword')?.setAttribute('disabled', 'disabled');
}

function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function escapeHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ── Startup ──────────────────────────────────────────────────────────────────
// app.js loads as a plain classic script (no type="module" in index.html), so
// every top-level function above is already global and reachable from the
// inline onclick="..." attributes in index.html. No extra wiring needed.

window.addEventListener('DOMContentLoaded', () => {
    setTheme(DEFAULT_THEME, { notify: false, persist: false });
    if (!sb) showConfigError();
});
