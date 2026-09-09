// ── Control Dashboard — client logic ────────────────────────────────────────
// Split out of index.html (was a 174 KB inline blob). Classic script (not a
// module) so the inline onclick= handlers in index.html keep working.

// Agent roster — only what actually runs. Keep in sync with update_data.py
// HERMES_AGENTS + agy. (coder/builder/tester profiles are dormant since Aug 2026.)
const AGENTS = [
    { id: 'aarz',  name: 'Aarz',  role: 'Chief Orchestrator', color: '#c49a6c', dim: 'rgba(196, 154, 108, 0.15)', icon: 'aarz.svg' },
    { id: 'agy',   name: 'agy',   role: 'Anti-Gravity CLI',   color: '#8bbccc', dim: 'rgba(139, 188, 204, 0.15)', icon: 'agy.svg' },
    { id: 'scout', name: 'Scout', role: 'Research Agent',     color: '#3a6ea5', dim: 'rgba(58, 110, 165, 0.15)',  icon: 'scout.svg' },
];

const WORKING_MS = 4 * 60 * 60 * 1000;   // agent card ACTIVE/STANDBY threshold
const STATS_ACTIVE_MS = 30 * 60 * 1000;  // Stats tab "In Progress" threshold
const SESSION_MS = 12 * 60 * 60 * 1000;
const REFRESH_MS = 30 * 1000;
const CACHE_TTL_MS = 60 * 1000;
const STALE_DATA_MS = 3 * 60 * 1000;     // collector output older than this = stale

// ── Fetch helpers ──────────────────────────────────────────────────────────

async function fetchJSON(url) {
    try {
        const r = await fetch(url, { cache: 'no-store' });
        return r.ok ? await r.json() : null;
    } catch { return null; }
}

// Same-origin write token, served by dashboard_server.py only on the bound IP.
let _writeToken = null;
async function getWriteToken() {
    if (_writeToken !== null) return _writeToken;
    try {
        const r = await fetch('/api/token', { cache: 'no-store' });
        _writeToken = r.ok ? (await r.text()).trim() : '';
    } catch { _writeToken = ''; }
    return _writeToken;
}

// ── Agent activity — read from server-computed agents.json ──────────────────
// No more directory-listing scraping of ~/.hermes, ~/.gemini, ~/.copilot.

let _agentsJson = null;
let _agentsJsonTs = 0;

async function loadAgentsJson() {
    const data = await fetchJSON('/agent-dashboard/agents.json');
    if (data && data.agents) {
        _agentsJson = data;
        _agentsJsonTs = Date.now();
    }
    return _agentsJson;
}

// Per-agent activity from agents.json (server reads the real ~/.hermes state.db).
function getAgentData(id) {
    const a = (_agentsJson && _agentsJson.agents && _agentsJson.agents[id]) || null;
    if (!a) return { status: 'dormant', ts: 0, sessions_today: 0, sessions_7d: 0, recent: [] };
    return {
        status: a.status || 'dormant',
        ts: a.last_active_ms || 0,
        sessions_today: a.sessions_today || 0,
        sessions_7d: a.sessions_7d || 0,
        last_title: a.last_title || null,
        last_source: a.last_source || null,
        recent: a.recent || [],
    };
}

function agentsDataAgeMs() {
    if (!_agentsJson || !_agentsJson._generated_at) return Infinity;
    return Date.now() - new Date(_agentsJson._generated_at).getTime();
}

// ── Toast notifications (replaces alert()) ─────────────────────────────────

function toast(msg, kind = 'info', ttl = 5000) {
    let host = document.getElementById('toast-host');
    if (!host) {
        host = document.createElement('div');
        host.id = 'toast-host';
        document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    el.textContent = msg;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 300);
    }, ttl);
}
function toast_err(msg) { toast(msg, 'error', 7000); }
function toast_ok(msg) { toast(msg, 'ok', 4000); }


// ── Formatters ─────────────────────────────────────────────────────────────

function formatAge(ms) {
    if (!ms || ms < 0) return null;
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (s < 60)    return s + 's ago';
    if (m < 60)    return m + 'm ' + (s % 60) + 's ago';
    if (h < 24)    return h + 'h ' + (m % 60) + 'm ago';
    return '~' + d + 'd ' + (h % 24) + 'h ago';
}

function exactTime(ms) {
    return ms ? new Date(ms).toLocaleString() : '—';
}

// ── Renderer ───────────────────────────────────────────────────────────────

const STATUS_TEXT = { active: 'ACTIVE', idle: 'IDLE', dormant: 'DORMANT' };

function cardHTML(agent, data) {
    const now = Date.now();
    const ts = data?.ts || 0;
    const status = data?.status || 'dormant';
    const working = status === 'active';
    const ageStr = ts ? formatAge(now - ts) : null;
    const recent = data?.recent || [];

    const lastLabel = data?.last_title || data?.last_source || '—';

    const recentHtml = recent.length ? `
    <div class="session-tooltip">
      <div class="session-tooltip-title">Recent runs</div>
      ${recent.slice(0, 5).map(r => `
      <div class="session-tooltip-row">
        <span class="st-name">${escapeHtml(r.title || r.source || '—')}</span>
        <span class="st-time">${formatAge(now - r.ts) || ''}</span>
      </div>`).join('')}
    </div>` : '';

    return `<div class="card status-${status} ${working ? 'active-core' : ''}" id="card-${agent.id}" style="--agent-color: ${agent.color}; --agent-dim: ${agent.dim};">
  <div class="card-shimmer"></div>
  <div class="card-top">
    <div class="avatar-container">
        <div class="status-arc"></div>
        <div class="status-arc-inner"></div>
        <div class="avatar"><img src="assets/${agent.icon}" alt="${escapeHtml(agent.name)}"></div>
    </div>
    <div class="card-info">
      <div class="card-name">${escapeHtml(agent.name)}</div>
      <div class="card-role">${escapeHtml(agent.role)}</div>
    </div>
    <div class="dot ${working ? 'working' : ''}"></div>
  </div>
  <div class="status-row">
    <span class="status-label status-${status}">${STATUS_TEXT[status] || 'DORMANT'}</span>
    <span class="time-ago" title="${exactTime(ts)}">${ageStr || 'no activity'}</span>
  </div>
  <div class="agent-metrics">
    <div class="agent-metric"><span class="am-num">${data?.sessions_today ?? 0}</span><span class="am-lbl">today</span></div>
    <div class="agent-metric"><span class="am-num">${data?.sessions_7d ?? 0}</span><span class="am-lbl">7 days</span></div>
  </div>
  <div class="card-foot">
    <span class="foot-label">Last:</span>
    <span class="foot-value" title="${escapeHtml(lastLabel)}">${escapeHtml(lastLabel)}</span>
  </div>
  ${recentHtml}
</div>`;
}

// ── Dynamic Tree Connecting Lines ───────────────────────────────────────────

const SVGNS = 'http://www.w3.org/2000/svg';
let _treeVinesAnimated = false;

function drawTreeLines() {
    const svg = document.getElementById('treeLinesSvg');
    if (!svg) return;
    const panel = document.getElementById('panel-agents');
    if (panel && !panel.classList.contains('active')) return; // hidden → skip work
    const container = document.querySelector('.tree-container');
    if (!container) return;

    // Read phase — gather every rect first so we don't interleave layout reads
    // with DOM writes (layout thrash).
    const containerRect = container.getBoundingClientRect();
    const fromEl = document.getElementById('card-aarz');
    if (!fromEl) return;
    const fromRect = fromEl.getBoundingClientRect();
    const segments = [];
    for (const a of AGENTS) {
        if (a.id === 'aarz') continue;
        const toEl = document.getElementById('card-' + a.id);
        if (!toEl) continue;
        const toRect = toEl.getBoundingClientRect();
        const x1 = fromRect.left + fromRect.width / 2 - containerRect.left;
        const y1 = fromRect.bottom - containerRect.top;
        const x2 = toRect.left + toRect.width / 2 - containerRect.left;
        const y2 = toRect.top - containerRect.top;
        const cy1 = y1 + (y2 - y1) * 0.45;
        const cy2 = y1 + (y2 - y1) * 0.55;
        segments.push(
            { d: `M ${x1} ${y1} C ${x1} ${cy1}, ${x2} ${cy2}, ${x2} ${y2}`,
              stroke: 'rgba(196, 154, 108, 0.35)', w: 2.2, vine: true },
            { d: `M ${x1} ${y1} C ${x1 + 8} ${cy1 - 2}, ${x2 - 8} ${cy2 + 2}, ${x2} ${y2}`,
              stroke: 'rgba(126, 181, 166, 0.22)', w: 1.2, vine: false },
        );
    }

    // Write phase — one fragment, one DOM swap.
    const frag = document.createDocumentFragment();
    for (const s of segments) {
        const p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('d', s.d);
        p.setAttribute('stroke', s.stroke);
        p.setAttribute('stroke-width', s.w);
        p.setAttribute('fill', 'none');
        // Only the first paint gets the grow-in animation; later redraws are static.
        if (s.vine && !_treeVinesAnimated) p.classList.add('tree-vine');
        frag.appendChild(p);
    }
    svg.replaceChildren(frag);
    _treeVinesAnimated = true;
}

// ── Cache management ────────────────────────────────────────────────────────

function getCached(id) {
    try {
        const c = localStorage.getItem('agent_' + id);
        if (c) {
            const parsed = JSON.parse(c);
            if (Date.now() - parsed.time < CACHE_TTL_MS) return parsed.data;
        }
    } catch {}
    return null;
}

function setCache(id, data) {
    try {
        localStorage.setItem('agent_' + id, JSON.stringify({ time: Date.now(), data }));
    } catch {}
}

let _cardsFirstPaint = true;
function renderCards(results) {
    const container = document.querySelector('.tree-container');
    if (_cardsFirstPaint && container) {
        container.classList.add('first-paint');
        setTimeout(() => container.classList.remove('first-paint'), 900);
        _cardsFirstPaint = false;
    }
    results.forEach(({ a, d }) => {
        const node = document.getElementById('node-' + a.id);
        if (node) {
            node.innerHTML = cardHTML(a, d);
        }
    });
    drawTreeLines();
}

function updateCard(agent, data) {
    const el = document.getElementById('card-' + agent.id);
    if (el) {
        // Only touching card #agent.id — card sizes don't change, so the tree
        // lines don't need redrawing here. Callers redraw once after a batch.
        el.outerHTML = cardHTML(agent, data);
    }
}

// ── Tabs controller ─────────────────────────────────────────────────────────

function switchTab(tabId) {
    document.querySelectorAll('.tab-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(el => el.classList.remove('active'));
    
    const activeTab = document.querySelector(`.tab-item[data-tab="${tabId}"]`);
    const activePanel = document.getElementById(`panel-${tabId}`);
    
    if (activeTab) activeTab.classList.add('active');
    if (activePanel) activePanel.classList.add('active');

    try { localStorage.setItem('dash_tab', tabId); } catch {}
    if (location.hash.slice(1) !== tabId) {
        history.replaceState(null, '', '#' + tabId);
    }

    if (tabId === 'agents') {
        setTimeout(drawTreeLines, 80);
    }
}

let latestMissionsJson = null;

let isCronPanelOpen = false;

function toggleCronPanel() {
    const panel = document.getElementById('cron-details-panel');
    if (!panel) return;
    if (isCronPanelOpen) {
        panel.style.maxHeight = '0';
        panel.style.opacity = '0';
        setTimeout(() => { panel.style.display = 'none'; }, 300);
        isCronPanelOpen = false;
    } else {
        panel.style.display = 'block';
        // Force reflow
        void panel.offsetWidth;
        panel.style.maxHeight = '2000px';
        panel.style.opacity = '1';
        isCronPanelOpen = true;
    }
}

function renderCronDetails(cronJobs) {
    const list = document.getElementById('cron-details-list');
    if (!list) return;
    
    if (cronJobs.length === 0) {
        list.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 12px;">No cron jobs found.</div>';
        return;
    }
    
    list.innerHTML = '';
    cronJobs.forEach(j => {
        const isFailing = j.last_status === "error" || j.last_error;
        const color = isFailing ? 'var(--terracotta)' : 'var(--sage)';
        
        let purpose = j.prompt || "";
        if (!purpose && j.script) purpose = "Script: " + j.script;
        if (!purpose) purpose = "No description";
        if (purpose.length > 60) purpose = purpose.substring(0, 57) + "...";
        
        let lastRun = "Never";
        if (j.last_run) {
            const ms = Date.now() - new Date(j.last_run).getTime();
            if (ms > 0 && typeof formatAge === 'function') {
                lastRun = formatAge(ms);
            } else {
                lastRun = new Date(j.last_run).toLocaleString();
            }
        }
        
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.padding = '12px 16px';
        div.style.background = 'rgba(0, 0, 0, 0.2)';
        div.style.border = '1px solid rgba(255, 255, 255, 0.05)';
        div.style.borderRadius = '8px';
        div.style.gap = '16px';
        
        div.innerHTML = `
            <div style="width: 10px; height: 10px; border-radius: 50%; background-color: ${color}; flex-shrink: 0; box-shadow: 0 0 8px ${color};"></div>
            <div style="flex: 1; min-width: 0;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                    <strong style="color: #fff; font-family: 'DM Sans', sans-serif; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${j.name || j.job_id}</strong>
                    <span style="color: var(--gold); font-size: 0.8rem; font-family: 'Share Tech Mono', monospace; opacity: 0.9;">${j.schedule}</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
                    <div style="color: var(--text-muted); font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${purpose}</div>
                    <div style="color: var(--text-muted); font-size: 0.75rem; white-space: nowrap; flex-shrink: 0;">Ran: ${lastRun}</div>
                </div>
            </div>
        `;
        list.appendChild(div);
    });
}

function updateStatsCounts() {
    let totalCount = 0;
    const gridEl = document.getElementById('stats-agent-grid');
    if (gridEl) gridEl.innerHTML = '';
    
    AGENTS.forEach(a => {
        const d = getAgentData(a.id);
        const count = d.sessions_today || 0;

        totalCount += count;

        if (gridEl) {
            const card = document.createElement('div');
            card.className = 'stats-agent-card';

            const dot = document.createElement('div');
            dot.className = 'stats-agent-dot' + (d.status === 'active' ? ' active' : ' standby');
            dot.style.setProperty('--agent-dot-color', a.color);
            dot.style.backgroundColor = a.color;
            
            const info = document.createElement('div');
            info.className = 'stats-agent-info';
            const nameEl = document.createElement('div');
            nameEl.className = 'stats-agent-name';
            nameEl.textContent = escapeHtml(a.name);
            info.appendChild(nameEl);
            
            const countEl = document.createElement('div');
            countEl.className = 'stats-agent-count' + (count === 0 ? ' zero' : '');
            countEl.textContent = count;
            
            card.appendChild(dot);
            card.appendChild(info);
            card.appendChild(countEl);
            gridEl.appendChild(card);
        }
    });
    
    const elTotal = document.getElementById('stat-total-sessions');
    if (elTotal) elTotal.textContent = totalCount;
    
    // Update "last updated" timestamp so user knows the data is live
    const elUpdated = document.getElementById('stat-last-updated');
    if (elUpdated) {
        const d = new Date();
        const h = d.getHours().toString().padStart(2,'0');
        const m = d.getMinutes().toString().padStart(2,'0');
        const s = d.getSeconds().toString().padStart(2,'0');
        elUpdated.textContent = `updated ${h}:${m}:${s} · auto-refresh 30s`;
    }
}

function updateCronStats() {
    if (!latestMissionsJson) return;
    const cronJobs = latestMissionsJson.cron || [];
    const activeCount = cronJobs.filter(j => j.status === 'ACTIVE').length;
    const pausedCount = cronJobs.filter(j => j.status !== 'ACTIVE').length;
    const failingCount = cronJobs.filter(j => j.last_status === 'error' || j.last_error).length;

    const elCronCount = document.getElementById('stat-cron-count');
    const elCronActive = document.getElementById('stat-cron-active');
    const elCronPaused = document.getElementById('stat-cron-paused');
    const elBadge = document.getElementById('stat-cron-health-badge');

    if (elCronCount) elCronCount.textContent = activeCount;
    if (elCronActive) elCronActive.textContent = activeCount;
    if (elCronPaused) elCronPaused.textContent = pausedCount;

    // Health badge on the tile — visible without expanding
    if (elBadge) {
        if (failingCount > 0) {
            elBadge.textContent = failingCount === 1 ? '1 failing' : failingCount + ' failing';
            elBadge.style.background = 'rgba(196, 108, 78, 0.15)';
            elBadge.style.color = 'var(--terracotta)';
            elBadge.style.border = '1px solid var(--terracotta)';
            elBadge.style.opacity = '1';
        } else if (cronJobs.length === 0) {
            elBadge.style.opacity = '0';
        } else {
            elBadge.textContent = 'All ' + cronJobs.length + ' healthy';
            elBadge.style.background = 'rgba(143, 163, 130, 0.15)';
            elBadge.style.color = 'var(--sage)';
            elBadge.style.border = '1px solid var(--sage)';
            elBadge.style.opacity = '1';
        }
    }

    // Populate the expansion panel list (even when collapsed, so opening is instant)
    renderCronDetails(cronJobs);
}

// "Sessions · 7d" = real agent sessions in the last 7 days (from state.db).
function updateTotalSessionCounts() {
    const el = document.getElementById('stat-total-sessions-all');
    if (!el) return;
    const agents = (_agentsJson && _agentsJson.agents) || {};
    const total = Object.values(agents).reduce((acc, a) => acc + (a.sessions_7d || 0), 0);
    el.textContent = total;
}

// ── Dynamic renderers for panels ───────────────────────────────────────────

function renderStatsPanel(h) {
    if (!h) return;
    
    const local = h.local || {};
    const localContainer = document.getElementById('local-health-list');
    if (localContainer) {
        localContainer.innerHTML = `
            <div class="health-item">
                <div class="health-item-hdr"><span>Uptime</span><span class="status-dot green"></span></div>
                <div class="health-item-value">${local.uptime || 'Unavailable'}</div>
            </div>
            <div class="health-item">
                <div class="health-item-hdr"><span>CPU Load</span><span class="status-dot green"></span></div>
                <div class="health-item-value">${local.cpu || 'Unavailable'}</div>
            </div>
            <div class="health-item">
                <div class="health-item-hdr"><span>Memory</span><span class="status-dot green"></span></div>
                <div class="health-item-value">${local.memory || 'Unavailable'}</div>
            </div>
            <div class="health-item">
                <div class="health-item-hdr"><span>Disk Usage</span><span class="status-dot green"></span></div>
                <div class="health-item-value">${local.disk || 'Unavailable'}</div>
            </div>
            <div class="health-item">
                <div class="health-item-hdr"><span>Docker Containers</span><span class="status-dot green"></span></div>
                <div class="health-item-value">${local.docker || 'Unavailable'}</div>
            </div>
            <div class="health-item">
                <div class="health-item-hdr"><span>Hermes Process</span><span class="status-dot ${local.hermes === 'Running' ? 'green' : 'red'}"></span></div>
                <div class="health-item-value">${local.hermes || 'Not running'}</div>
            </div>
        `;
    }
    
    const rServer = h.r_server || {};
    const rContainer = document.getElementById('r-server-health-list');
    if (rContainer) {
        rContainer.innerHTML = `
            <div class="health-item">
                <div class="health-item-hdr"><span>Uptime</span><span class="status-dot ${rServer.uptime?.ok ? 'green' : 'red'}"></span></div>
                <div class="health-item-value">${rServer.uptime?.output || 'Connection Error'}</div>
            </div>
            <div class="health-item">
                <div class="health-item-hdr"><span>Docker Containers</span><span class="status-dot ${rServer.docker?.ok ? 'green' : 'red'}"></span></div>
                <div class="health-item-value">${rServer.docker?.output || 'Connection Error'}</div>
            </div>
            <div class="health-item">
                <div class="health-item-hdr"><span>Memory</span><span class="status-dot ${rServer.memory?.ok ? 'green' : 'red'}"></span></div>
                <div class="health-item-value">${rServer.memory?.output || 'Connection Error'}</div>
            </div>
            <div class="health-item">
                <div class="health-item-hdr"><span>Disk</span><span class="status-dot ${rServer.disk?.ok ? 'green' : 'red'}"></span></div>
                <div class="health-item-value">${rServer.disk?.output || 'Connection Error'}</div>
            </div>
        `;
    }
}

function renderMissions(data) {
    // Support envelope format {_fetched_at, repos} and legacy plain array
    const isEnvelope = data && typeof data === 'object' && !Array.isArray(data) && data.repos;
    const repos = isEnvelope ? data.repos : (Array.isArray(data) ? data : null);
    const fetchedAt = isEnvelope ? data._fetched_at : null;

    if (!repos || repos.length === 0) {
        const reposGrid = document.getElementById('repos-grid');
        const emptyMsg = document.getElementById('empty-missions-msg');
        const lastUpdated = document.getElementById('repos-last-updated');
        if (reposGrid) reposGrid.style.display = 'none';
        if (emptyMsg) emptyMsg.style.display = 'flex';
        if (lastUpdated) lastUpdated.textContent = '';
        return;
    }

    const reposGrid = document.getElementById('repos-grid');
    const emptyMsg = document.getElementById('empty-missions-msg');
    const lastUpdated = document.getElementById('repos-last-updated');

    // Fetch missions_state.json (also handled by loadMissionsState helper for retry)
    loadMissionsState().then(state => {
        if (reposGrid) {
            reposGrid.style.display = 'block';
            reposGrid.innerHTML = renderMissionsSections(repos, state);
            // Wire click handlers for action buttons
            reposGrid.querySelectorAll('[data-mission-action]').forEach(btn => {
                btn.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const action = btn.getAttribute('data-mission-action');
                    const repo = btn.getAttribute('data-repo');
                    handleMissionAction(action, repo);
                });
            });
            // Wire click handlers for priority badges (open inline editor)
            reposGrid.querySelectorAll('[data-priority-badge-for]').forEach(badge => {
                badge.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const repo = badge.getAttribute('data-priority-badge-for');
                    openPriorityEditor(repo);
                });
            });
            // Wire save/cancel buttons inside the (already-open) priority editor
            reposGrid.querySelectorAll('[data-priority-save-for]').forEach(btn => {
                btn.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const repo = btn.getAttribute('data-priority-save-for');
                    commitPriorityEditor(repo);
                });
            });
            reposGrid.querySelectorAll('[data-priority-cancel-for]').forEach(btn => {
                btn.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const repo = btn.getAttribute('data-priority-cancel-for');
                    closePriorityEditor(repo);
                });
            });
            // ─── Drag & drop wiring ──────────────────────────────────
            // Use event delegation on the grid so re-renders don't lose listeners.
            // The handlers close over _dragSrc module-scope state.
            reposGrid.addEventListener('dragstart', onDragStart);
            reposGrid.addEventListener('dragend', onDragEnd);
            reposGrid.addEventListener('dragover', (e) => {
                // Try section drop first (any valid drop-section), then card reorder within missions.
                // Sections: mission-active | mission-inactive | project. Unclassified is not droppable.
                const section = e.target.closest('.missions-section[data-drop-section]');
                const dropSection = section ? section.getAttribute('data-drop-section') : null;
                const isDroppable = dropSection && dropSection !== 'unclassified';
                const missionCard = e.target.closest('.repo-card.mission-card');
                if (isDroppable) {
                    // Allow drop on any droppable section regardless of src kind —
                    // routing (promote / demote / toggle) is decided in onDrop.
                    onDragOver(e);
                } else if (missionCard && _dragSrc && _dragSrc.kind === 'mission') {
                    onDragOverMissionCard(e);
                }
            });
            reposGrid.addEventListener('dragleave', (e) => {
                // Distinguish section-leave from card-leave based on target
                if (e.target.closest('.missions-section') && !e.target.closest('.repo-card.mission-card')) {
                    onDragLeave(e);
                } else if (e.target.closest('.repo-card.mission-card')) {
                    onDragLeaveMissionCard(e);
                }
            });
            reposGrid.addEventListener('drop', (e) => {
                const section = e.target.closest('.missions-section[data-drop-section]');
                const dropSection = section ? section.getAttribute('data-drop-section') : null;
                const isDroppable = dropSection && dropSection !== 'unclassified';
                const missionCard = e.target.closest('.repo-card.mission-card');
                if (isDroppable) {
                    onDrop(e);
                } else if (missionCard && _dragSrc && _dragSrc.kind === 'mission') {
                    onDropOnMissionCard(e);
                }
            });
        }
        if (emptyMsg) emptyMsg.style.display = 'none';

        // Update counts
        const missionsObj = (state && state.missions) || {};
        const activeCount = Object.values(missionsObj).filter(m => m.status === 'active').length;
        const inactiveCount = Object.values(missionsObj).filter(m => m.status === 'inactive').length;
        const projectCount = (state && Array.isArray(state.projects)) ? state.projects.length : 0;
        const acEl = document.getElementById('missions-count-active');
        if (acEl) acEl.textContent = activeCount;
        const icEl = document.getElementById('missions-count-inactive');
        if (icEl) icEl.textContent = inactiveCount;
        const pcEl = document.getElementById('missions-count-projects');
        if (pcEl) pcEl.textContent = projectCount;
        // Legacy count badge
        const totalEl = document.getElementById('missions-count');
        if (totalEl) totalEl.textContent = activeCount + inactiveCount + projectCount;
    });

    // Show last-synced timestamp + sync dot state
    const syncText = document.getElementById('missions-sync-text');
    const syncDot = document.getElementById('missions-sync-dot');
    if (fetchedAt) {
        const fetchedDate = new Date(fetchedAt);
        if (lastUpdated) lastUpdated.textContent = `Last synced: ${fetchedDate.toLocaleString()}`;
        const minutesSince = (Date.now() - fetchedDate.getTime()) / 60000;
        const hoursSince = minutesSince / 60;
        // repos.json refreshes nightly (+ on repo create/delete), so "recent"
        // is measured in hours, not minutes. Only flag red past ~26h.
        if (syncDot) {
            syncDot.classList.remove('syncing', 'stale');
            if (hoursSince > 26) syncDot.classList.add('stale');
        }
        if (syncText) {
            if (minutesSince <= 90)     syncText.textContent = 'Synced';
            else if (hoursSince <= 26)  syncText.textContent = `Synced ${Math.round(hoursSince)}h ago`;
            else                        syncText.textContent = `Stale — ${Math.round(hoursSince)}h ago`;
        }
        // Stale warning banner: if older than ~26 hours (a nightly sync was missed)
        const banner = document.getElementById('missions-stale-banner');
        if (banner) {
            if (hoursSince > 26) banner.classList.add('visible');
            else                 banner.classList.remove('visible');
        }
    } else {
        if (lastUpdated) lastUpdated.textContent = '';
        if (syncText)    syncText.textContent = 'No data';
        if (syncDot)     syncDot.classList.remove('syncing', 'stale');
    }
}

function renderMissionsSections(repos, state) {
    const missionsObj = (state && state.missions) || {};
    const projectsList = (state && Array.isArray(state.projects)) ? state.projects : [];

    // Build lookup by name
    const repoByName = {};
    for (const r of repos) repoByName[r.name] = r;

    // Sort missions by (priority ASC, order ASC, name ASC) — top of list = highest priority
    const sortedMissionNames = Object.keys(missionsObj).sort((a, b) => {
        const ea = missionsObj[a] || {};
        const eb = missionsObj[b] || {};
        const pa = (typeof ea.priority === 'number') ? ea.priority : 99;
        const pb = (typeof eb.priority === 'number') ? eb.priority : 99;
        if (pa !== pb) return pa - pb;
        const oa = (typeof ea.order === 'number') ? ea.order : 999;
        const ob = (typeof eb.order === 'number') ? eb.order : 999;
        if (oa !== ob) return oa - ob;
        return a.localeCompare(b);
    });

    const activeMissions = [];
    const inactiveMissions = [];
    const projects = [];
    const unclassified = [];

    // First: process missions in sorted order so high-priority missions render first.
    // Repos in state.missions are NOT also pushed to projects — even if they're also
    // in state.projects, the mission entry wins for classification (since the user
    // explicitly tracked them as a mission at some point). This dedupes the DOM so
    // the same repo card doesn't appear in two sections simultaneously.
    for (const name of sortedMissionNames) {
        const entry = missionsObj[name];
        if (!entry) continue;
        if (entry.status === 'active') activeMissions.push(name);
        else if (entry.status === 'inactive') inactiveMissions.push(name);
        // deleted entries are hidden
    }
    // Projects: skip anything that's already classified as a mission
    const missionRepoSet = new Set([...activeMissions, ...inactiveMissions]);
    for (const name of projectsList) {
        if (!missionRepoSet.has(name)) projects.push(name);
    }

    // Then: any repo in repos.json that is neither a known mission nor project
    const classifiedSet = new Set([
        ...Object.keys(missionsObj),
        ...projectsList,
    ]);
    for (const r of repos) {
        if (!classifiedSet.has(r.name)) unclassified.push(r.name);
    }

    // Decide visual priority class from numeric priority
    const priorityClass = (p) => {
        if (typeof p !== 'number') return 'priority-normal';
        if (p <= 3) return 'priority-top';
        if (p <= 10) return 'priority-high';
        return 'priority-normal';
    };

    // Build inline priority editor (rendered when badge is clicked)
    const renderPriorityEditor = (repoName, currentPriority) => {
        const safeRepo = escapeHtml(repoName);
        return `
            <span class="priority-editor" data-priority-editor-for="${safeRepo}">
                <input type="number" min="1" max="99" value="${currentPriority}" data-priority-input-for="${safeRepo}" />
                <button data-priority-save-for="${safeRepo}" title="Save">✓</button>
                <button data-priority-cancel-for="${safeRepo}" title="Cancel">✕</button>
            </span>
        `;
    };

    const renderCard = (repoName, kind /* 'mission-active' | 'mission-inactive' | 'project' | 'unclassified' */) => {
        const repo = repoByName[repoName] || { name: repoName, description: '', updated_at: '', html_url: `https://github.com/Aarz-aaryan/${repoName}`, private: false };
        const visClass = repo.private ? 'private' : 'public';
        const visLabel = repo.private ? 'private' : 'public';
        const desc = repo.description
            ? `<span class="repo-description">${escapeHtml(repo.description)}</span>`
            : `<span class="repo-description empty">No description</span>`;
        const updated = repo.updated_at
            ? new Date(repo.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
            : '—';
        let badge = '';
        let actions = '';
        // Priority is only meaningful for active missions (the most-urgent list).
        // For inactive missions we show the stored priority too so it persists across toggles.
        const entry = missionsObj[repoName] || {};
        const priorityVal = (typeof entry.priority === 'number') ? entry.priority : null;
        let priorityBadgeHtml = '';
        if (priorityVal !== null) {
            const pClass = priorityClass(priorityVal);
            const safeRepo = escapeHtml(repoName);
            const pLabel = priorityVal === 1 ? '#1' : `#${priorityVal}`;
            priorityBadgeHtml = `<span class="priority-badge ${pClass}" data-priority-badge-for="${safeRepo}" title="Click to edit priority (1=most important, 99=least)">${pLabel}</span>`;
        }
        if (kind === 'mission-active') {
            badge = `<span class="status-pill status-active">● ACTIVE</span>`;
            actions = `
                <button class="action-btn action-toggle" data-mission-action="toggle" data-repo="${escapeHtml(repoName)}" title="Deactivate">⏸ Deactivate</button>
                <button class="action-btn action-delete" data-mission-action="delete" data-repo="${escapeHtml(repoName)}" title="Soft-delete">✕ Delete</button>
                <button class="action-btn action-remove-repo" data-mission-action="delete-repo" data-repo="${escapeHtml(repoName)}" title="Permanently delete GitHub repo + remove from dashboard">🗑 Remove</button>`;
        } else if (kind === 'mission-inactive') {
            badge = '<span class="status-pill status-inactive">○ INACTIVE</span>';
            actions = `
                <button class="action-btn action-toggle" data-mission-action="toggle" data-repo="${escapeHtml(repoName)}" title="Activate">▶ Activate</button>
                <button class="action-btn action-delete" data-mission-action="delete" data-repo="${escapeHtml(repoName)}" title="Soft-delete">✕ Delete</button>
                <button class="action-btn action-remove-repo" data-mission-action="delete-repo" data-repo="${escapeHtml(repoName)}" title="Permanently delete GitHub repo + remove from dashboard">🗑 Remove</button>`;
        } else if (kind === 'unclassified') {
            badge = '<span class="status-pill status-unclassified">? UNCLASSIFIED</span>';
            actions = `
                <button class="action-btn action-classify" data-mission-action="classify-project" data-repo="${escapeHtml(repoName)}" title="Classify as project">◆ Classify as Project</button>
                <button class="action-btn action-promote" data-mission-action="promote" data-repo="${escapeHtml(repoName)}" title="Promote to active mission">◉ Promote to Mission</button>
                <button class="action-btn action-remove-repo" data-mission-action="delete-repo" data-repo="${escapeHtml(repoName)}" title="Permanently delete GitHub repo + remove from dashboard">🗑 Remove</button>`;
        } else {
            badge = '<span class="status-pill status-project">◆ PROJECT</span>';
            actions = `
                <button class="action-btn action-remove-repo" data-mission-action="delete-repo" data-repo="${escapeHtml(repoName)}" title="Permanently delete GitHub repo + remove from dashboard">🗑 Remove</button>`;
        }
        const cardClass = kind === 'project' ? 'repo-card project-card'
            : kind === 'unclassified' ? 'repo-card unclassified-card'
            : 'repo-card mission-card ' + kind;
        // draggable: project cards drag to missions section (promote); mission cards drag to projects (demote)
        // unclassified cards don't drag — they have explicit promote/classify buttons.
        const draggable = (kind === 'project' || kind === 'mission-active' || kind === 'mission-inactive');
        const dragKind = kind === 'project' ? 'project'
            : (kind === 'mission-active' || kind === 'mission-inactive') ? 'mission'
            : 'none';
        // The whole card is wrapped in an <a> link. Browsers don't fire dragstart from inside an
        // <a> unless the <a> itself is draggable. Setting draggable on the <a> lets drags start
        // from anywhere on the card (not just the .repo-actions area below the link).
        return `
            <div class="${cardClass}" data-repo="${escapeHtml(repoName)}">
                <a href="${escapeHtml(repo.html_url)}" target="_blank" class="repo-card-link"
                   draggable="${draggable}" data-drag-kind="${dragKind}" data-repo="${escapeHtml(repoName)}">
                    <div class="repo-card-top">
                        <span class="repo-name">${escapeHtml(repo.name)}</span>
                        ${priorityBadgeHtml}
                        <span class="repo-visibility ${visClass}">${visLabel}</span>
                    </div>
                    ${desc}
                    <div class="repo-card-bottom">
                        ${badge}
                        <span class="repo-updated">${updated}</span>
                    </div>
                </a>
                ${actions ? `<div class="repo-actions" draggable="${draggable}" data-drag-kind="${dragKind}" data-repo="${escapeHtml(repoName)}">${actions}</div>` : ''}
            </div>
        `;
    };

    // Static per-section drop hint — describes what HAPPENS when you drop a CARD here.
    // We don't know the source kind at render time, so the text is generic per section.
    // The actual routing (promote / demote / toggle) happens in onDrop based on src+target.
    const sectionDropHint = (sectionKind) => {
        if (sectionKind === 'mission-active') return 'Drop here — promotes project, or reactivates an inactive mission';
        if (sectionKind === 'mission-inactive') return 'Drop here — promotes project, or deactivates an active mission';
        if (sectionKind === 'project') return 'Drop here — demotes any mission back to a project';
        return null;
    };

    const section = (title, icon, countId, items, kind) => {
        // Always render the section, even when empty — so users have a visible drop target
        // when they want to drag a project to become a mission (or vice versa).
        // data-drop-section is the SPECIFIC section id — used by drop handlers to route
        // project↔mission (promote/demote) AND mission↔mission (toggle active↔inactive).
        const countElId = countId;
        const inner = items.length === 0
            ? (kind === 'unclassified'
                ? `<div class="missions-empty-hint">No repos in this category</div>`
                : `<div class="missions-empty-hint">${sectionDropHint(kind) || 'Drop here'}</div>`)
            : `<div class="repos-grid-inner">${items.map(n => renderCard(n, kind)).join('')}</div>`;
        return `
            <div class="missions-section ${kind}" data-drop-section="${kind}">
                <div class="missions-section-header">
                    <span class="missions-section-icon">${icon}</span>
                    <span class="missions-section-title">${title}</span>
                    <span class="missions-section-count" id="${countElId}">${items.length}</span>
                </div>
                ${inner}
            </div>
        `;
    };

    // Drop zones — full bidirectional drag-and-drop:
    //   project          → mission-active/mission-inactive → promote (always lands in active)
    //   mission-active   → mission-inactive                → toggle (deactivate)
    //   mission-inactive → mission-active                  → toggle (activate)
    //   mission-active   → project                         → demote
    //   mission-inactive → project                         → demote
    //   project          → project                         → no-op (could reorder later)
    //   mission-*        → same section                    → no-op
    //   unclassified has no drop-section (cards there don't drag)
    return [
        section('ACTIVE MISSIONS', '◉', 'missions-count-active', activeMissions, 'mission-active'),
        section('INACTIVE MISSIONS', '○', 'missions-count-inactive', inactiveMissions, 'mission-inactive'),
        section('PROJECTS', '◆', 'missions-count-projects', projects, 'project'),
        section('UNCLASSIFIED', '?', 'missions-count-unclassified', unclassified, 'unclassified'),
    ].filter(Boolean).join('');
}

let _missionsStateCache = null;
let _missionsStateTs = 0;
async function loadMissionsState() {
    // Cache for 5s to avoid hammering during rapid toggles
    if (_missionsStateCache && (Date.now() - _missionsStateTs) < 5000) {
        return _missionsStateCache;
    }
    try {
        const res = await fetch('/agent-dashboard/missions_state.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _missionsStateCache = await res.json();
        _missionsStateTs = Date.now();
        return _missionsStateCache;
    } catch (e) {
        console.warn('Failed to load missions_state.json:', e);
        return _missionsStateCache || { _version: 1, missions: {}, projects: [] };
    }
}

async function handleMissionAction(action, repo) {
    // delete-repo is destructive + needs confirmation, intercept before fetch
    if (action === 'delete-repo') {
        openRemoveRepoModal(repo);
        return;
    }
    // Dedupe in-flight requests on the same (action, repo) pair
    const key = `${action}:${repo}`;
    if (_missionActionInFlight.has(key)) {
        console.debug(`Action ${key} already in flight, ignoring duplicate`);
        return;
    }
    _missionActionInFlight.add(key);
    // Disable all matching buttons visually while in flight
    document.querySelectorAll(`[data-mission-action="${action}"][data-repo="${CSS.escape(repo)}"]`)
        .forEach(btn => { btn.disabled = true; btn.classList.add('action-busy'); });

    const url = `/api/missions/${action}`;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': await getWriteToken() },
            body: JSON.stringify({ repo }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            console.error('Mission action failed:', data);
            toast_err(`Mission ${action} failed: ${data.error || res.status}`);
            return;
        }
        // Invalidate cache and re-render. Re-fetch state through the same-origin
        // proxy — the writer just wrote it, so this is the freshest source.
        _missionsStateCache = null;
        _missionsStateTs = 0;
        let freshState = null;
        try {
            const stateRes = await fetch(`/api/missions/state`, { cache: 'no-store' });
            if (stateRes.ok) freshState = await stateRes.json();
        } catch (e) {
            console.warn('Could not fetch fresh missions state:', e);
        }
        if (freshState) {
            // Seed the cache with the post-action authoritative state, then re-render.
            // This eliminates any race between the post-action fetch and the 30s auto-refresh.
            _missionsStateCache = freshState;
            _missionsStateTs = Date.now();
        }
        // Re-trigger render by calling renderMissions with cached repos data
        const reposRes = await fetch('/agent-dashboard/repos.json', { cache: 'no-store' });
        const reposData = await reposRes.json();
        renderMissions(reposData);
    } catch (e) {
        console.error('Mission action network error:', e);
        toast_err(`Network error: ${e.message}`);
    } finally {
        _missionActionInFlight.delete(key);
        // Re-enable buttons (the re-render will have rebuilt them, but if it failed, this still helps)
        document.querySelectorAll(`[data-mission-action="${action}"][data-repo="${CSS.escape(repo)}"]`)
            .forEach(btn => { btn.disabled = false; btn.classList.remove('action-busy'); });
    }
}

// ─── Create Mission / Project modal ───────────────────────────────────────────
let _createSubmitInFlight = false;
function openCreateModal() {
    const overlay = document.getElementById('modal-create-overlay');
    overlay.style.display = 'flex';
    // Reset form
    document.getElementById('input-title').value = '';
    document.getElementById('input-description').value = '';
    document.getElementById('input-kind').value = 'mission';
    document.getElementById('input-priority').value = '99';
    document.getElementById('input-private').checked = false;
    const err = document.getElementById('modal-create-error');
    err.style.display = 'none';
    err.textContent = '';
    // Focus first input
    setTimeout(() => document.getElementById('input-title').focus(), 80);
}
function closeCreateModal() {
    document.getElementById('modal-create-overlay').style.display = 'none';
}
async function submitCreateMission(ev) {
    ev.preventDefault();
    if (_createSubmitInFlight) return;
    const title = document.getElementById('input-title').value.trim();
    const description = document.getElementById('input-description').value.trim();
    const kind = document.getElementById('input-kind').value;
    const priority = parseInt(document.getElementById('input-priority').value, 10) || 99;
    const isPrivate = document.getElementById('input-private').checked;
    const errEl = document.getElementById('modal-create-error');
    const submitBtn = document.getElementById('modal-create-submit');
    errEl.style.display = 'none';
    errEl.textContent = '';
    if (!title) {
        errEl.textContent = 'Title is required.';
        errEl.style.display = 'block';
        return;
    }
    _createSubmitInFlight = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';
    try {
        const url = `/api/missions/create-repo`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': await getWriteToken() },
            body: JSON.stringify({
                title, description, kind, priority,
                private: isPrivate,
            }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            errEl.textContent = data.error || `Server returned ${res.status}`;
            errEl.style.display = 'block';
            return;
        }
        // Success — close modal, refresh state + repos
        closeCreateModal();
        _missionsStateCache = null;
        _missionsStateTs = 0;
        try {
            const stateRes = await fetch(`/api/missions/state`, { cache: 'no-store' });
            if (stateRes.ok) {
                _missionsStateCache = await stateRes.json();
                _missionsStateTs = Date.now();
            }
        } catch (e) { /* ignore */ }
        const reposRes = await fetch('/agent-dashboard/repos.json', { cache: 'no-store' });
        const reposData = await reposRes.json();
        renderMissions(reposData);
    } catch (e) {
        console.error('Create mission failed:', e);
        errEl.textContent = `Network error: ${e.message}`;
        errEl.style.display = 'block';
    } finally {
        _createSubmitInFlight = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create';
    }
}

// ─── Confirm Remove (GitHub delete) modal ─────────────────────────────────────
let _removeRepoTarget = null;
let _removeRepoInFlight = false;
function openRemoveRepoModal(repo) {
    _removeRepoTarget = repo;
    document.getElementById('modal-remove-repo-name').textContent = repo;
    const err = document.getElementById('modal-remove-error');
    err.style.display = 'none';
    err.textContent = '';
    document.getElementById('modal-remove-confirm').disabled = false;
    document.getElementById('modal-remove-confirm').textContent = 'Delete repository';
    document.getElementById('modal-remove-overlay').style.display = 'flex';
}
function closeRemoveRepoModal() {
    _removeRepoTarget = null;
    document.getElementById('modal-remove-overlay').style.display = 'none';
}
async function confirmRemoveRepo() {
    if (_removeRepoInFlight || !_removeRepoTarget) return;
    const repo = _removeRepoTarget;
    const errEl = document.getElementById('modal-remove-error');
    const btn = document.getElementById('modal-remove-confirm');
    errEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Deleting...';
    _removeRepoInFlight = true;
    try {
        const url = `/api/missions/delete-repo`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': await getWriteToken() },
            body: JSON.stringify({ repo }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            errEl.textContent = data.error || `Server returned ${res.status}`;
            errEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Delete repository';
            return;
        }
        closeRemoveRepoModal();
        _missionsStateCache = null;
        _missionsStateTs = 0;
        try {
            const stateRes = await fetch(`/api/missions/state`, { cache: 'no-store' });
            if (stateRes.ok) {
                _missionsStateCache = await stateRes.json();
                _missionsStateTs = Date.now();
            }
        } catch (e) { /* ignore */ }
        const reposRes = await fetch('/agent-dashboard/repos.json', { cache: 'no-store' });
        const reposData = await reposRes.json();
        renderMissions(reposData);
    } catch (e) {
        console.error('Remove repo failed:', e);
        errEl.textContent = `Network error: ${e.message}`;
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Delete repository';
    } finally {
        _removeRepoInFlight = false;
    }
}

// Wire up modal handlers (run once on script load)
function wireMissionModals() {
    document.getElementById('btn-create-mission').addEventListener('click', openCreateModal);
    document.getElementById('modal-create-close').addEventListener('click', closeCreateModal);
    document.getElementById('modal-create-cancel').addEventListener('click', closeCreateModal);
    document.getElementById('form-create').addEventListener('submit', submitCreateMission);

    document.getElementById('modal-remove-close').addEventListener('click', closeRemoveRepoModal);
    document.getElementById('modal-remove-cancel').addEventListener('click', closeRemoveRepoModal);
    document.getElementById('modal-remove-confirm').addEventListener('click', confirmRemoveRepo);

    // Close on overlay click (but not on card click)
    document.getElementById('modal-create-overlay').addEventListener('click', (e) => {
        if (e.target.id === 'modal-create-overlay') closeCreateModal();
    });
    document.getElementById('modal-remove-overlay').addEventListener('click', (e) => {
        if (e.target.id === 'modal-remove-overlay') closeRemoveRepoModal();
    });
    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (document.getElementById('modal-create-overlay').style.display !== 'none') closeCreateModal();
            if (document.getElementById('modal-remove-overlay').style.display !== 'none') closeRemoveRepoModal();
        }
    });
}

// ─── Priority editor (click badge → inline number input → save) ────────────
function openPriorityEditor(repo) {
    // Hide the badge, show the editor inline
    const badge = document.querySelector(`[data-priority-badge-for="${CSS.escape(repo)}"]`);
    const card = badge ? badge.closest('.repo-card') : null;
    if (!card) return;
    const existing = card.querySelector(`[data-priority-editor-for="${CSS.escape(repo)}"]`);
    if (existing) return; // already open
    // Read current priority from state cache (or fallback to badge text)
    let current = 99;
    try {
        const state = _missionsStateCache || {};
        const entry = (state.missions || {})[repo];
        if (entry && typeof entry.priority === 'number') current = entry.priority;
    } catch (_) {}
    if (badge) badge.style.display = 'none';
    // Insert editor into card-top after the (hidden) badge
    const editorHtml = `
        <span class="priority-editor" data-priority-editor-for="${repo}">
            <input type="number" min="1" max="99" value="${current}" data-priority-input-for="${repo}" />
            <button data-priority-save-for="${repo}" title="Save">✓</button>
            <button data-priority-cancel-for="${repo}" title="Cancel">✕</button>
        </span>
    `;
    if (badge) badge.insertAdjacentHTML('afterend', editorHtml);
    else card.querySelector('.repo-card-top').insertAdjacentHTML('beforeend', editorHtml);
    const input = card.querySelector(`[data-priority-input-for="${CSS.escape(repo)}"]`);
    if (input) {
        input.focus();
        input.select();
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitPriorityEditor(repo); }
            else if (e.key === 'Escape') { e.preventDefault(); closePriorityEditor(repo); }
        });
    }
}

function closePriorityEditor(repo) {
    const editor = document.querySelector(`[data-priority-editor-for="${CSS.escape(repo)}"]`);
    if (editor) editor.remove();
    const badge = document.querySelector(`[data-priority-badge-for="${CSS.escape(repo)}"]`);
    if (badge) badge.style.display = '';
}

async function commitPriorityEditor(repo) {
    const input = document.querySelector(`[data-priority-input-for="${CSS.escape(repo)}"]`);
    if (!input) return;
    const newPrio = parseInt(input.value, 10);
    if (!Number.isFinite(newPrio) || newPrio < 1 || newPrio > 99) {
        toast_err(`Priority must be a number 1–99 (got "${input.value}")`);
        return;
    }
    // Optimistic close
    closePriorityEditor(repo);
    await postMissionAction('set-priority', repo, { priority: newPrio });
}

async function postMissionAction(action, repo, extraBody = {}) {
    // Generic helper used by drag/drop and priority editor.
    // Some actions (reorder-missions) don't take a repo — pass repo=null for those.
    const key = `${action}:${repo || '<no-repo>'}:${JSON.stringify(extraBody)}`;
    if (_missionActionInFlight.has(key)) return;
    _missionActionInFlight.add(key);
    try {
        const url = `/api/missions/${action}`;
        const body = (action === 'reorder-missions')
            ? { ...extraBody }
            : { repo, ...extraBody };
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': await getWriteToken() },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            toast_err(`Mission ${action} failed: ${data.error || res.status}`);
            return false;
        }
        // Refresh cache + re-render
        _missionsStateCache = null;
        _missionsStateTs = 0;
        try {
            const stateRes = await fetch(`/api/missions/state`, { cache: 'no-store' });
            if (stateRes.ok) {
                _missionsStateCache = await stateRes.json();
                _missionsStateTs = Date.now();
            }
        } catch (_) {}
        const reposRes = await fetch('/agent-dashboard/repos.json', { cache: 'no-store' });
        const reposData = await reposRes.json();
        renderMissions(reposData);
        return true;
    } catch (e) {
        toast_err(`Network error: ${e.message}`);
        return false;
    } finally {
        _missionActionInFlight.delete(key);
    }
}

// ─── Drag & drop handlers ───────────────────────────────────────────────────
// State for the in-flight drag operation. Module-scoped to avoid parameter-drilling.
let _dragSrc = null;          // {repo, kind, section} of the card being dragged
                                  //   kind    : 'project' | 'mission' (from data-drag-kind on the <a>)
                                  //   section : 'mission-active' | 'mission-inactive' | 'project' (from data-drop-section on the section containing the card)
let _lastDragOverSection = null; // the missions-section the cursor is currently over

function onDragStart(e) {
    // The draggable element is either the <a class="repo-card-link"> or <div class="repo-actions">,
    // BOTH of which carry data-drag-kind. Walk up to find the nearest ancestor with data-drag-kind
    // (or the element itself) and use it as the drag source.
    const card = e.target.closest('[data-drag-kind]:not([data-drag-kind="none"])');
    if (!card) return;
    // Find which section this card lives in — used by onDrop to route mission-active ↔ inactive.
    const srcSectionEl = card.closest('.missions-section[data-drop-section]');
    _dragSrc = {
        repo: card.getAttribute('data-repo'),
        kind: card.getAttribute('data-drag-kind'), // 'project' | 'mission'
        section: srcSectionEl ? srcSectionEl.getAttribute('data-drop-section') : null,
    };
    // Visual cue: highlight the whole .repo-card (the outer div) for clarity
    const outerCard = card.closest('.repo-card') || card;
    outerCard.classList.add('dragging');
    // Required for Firefox to actually start the drag
    try { e.dataTransfer.setData('text/plain', _dragSrc.repo); } catch (_) {}
    e.dataTransfer.effectAllowed = 'move';
}

function onDragEnd(e) {
    const card = e.target.closest('.repo-card');
    if (card) card.classList.remove('dragging');
    // Clear any drop-target highlights
    document.querySelectorAll('.missions-section.drop-target').forEach(s => s.classList.remove('drop-target'));
    _dragSrc = null;
    _lastDragOverSection = null;
}

function onDragOver(e) {
    if (!_dragSrc) return;
    const section = e.target.closest('.missions-section[data-drop-section]');
    if (!section) return;
    const targetSection = section.getAttribute('data-drop-section'); // 'mission-active' | 'mission-inactive' | 'project'
    if (targetSection === 'unclassified') return;
    // Allow drop on ANY droppable section. The same-section case (mission → same mission section,
    // project → project) is a no-op in onDrop; we still allow dragover so the highlight shows
    // user feedback even if the drop ultimately does nothing.
    e.preventDefault(); // signals this is a valid drop target
    e.dataTransfer.dropEffect = 'move';
    if (section !== _lastDragOverSection) {
        if (_lastDragOverSection) _lastDragOverSection.classList.remove('drop-target');
        section.classList.add('drop-target');
        _lastDragOverSection = section;
    }
}

function onDragLeave(e) {
    // Only clear highlight if the cursor truly left the section (not just crossed a child)
    const section = e.target.closest('.missions-section');
    if (!section) return;
    if (!section.contains(e.relatedTarget)) {
        section.classList.remove('drop-target');
        if (_lastDragOverSection === section) _lastDragOverSection = null;
    }
}

async function onDrop(e) {
    if (!_dragSrc) return;
    const section = e.target.closest('.missions-section[data-drop-section]');
    if (!section) return;
    const targetSection = section.getAttribute('data-drop-section'); // 'mission-active' | 'mission-inactive' | 'project'
    if (targetSection === 'unclassified') return;
    e.preventDefault();
    section.classList.remove('drop-target');

    const src = _dragSrc;
    _dragSrc = null;

    // Full bidirectional routing matrix:
    //   project          → mission-active      → promote (lands in active)
    //   project          → mission-inactive    → promote (lands in active — caller prefers active)
    //   mission-active   → mission-inactive    → toggle (deactivate)
    //   mission-inactive → mission-active      → toggle (activate)
    //   mission-active   → project             → demote
    //   mission-inactive → project             → demote
    //   project          → project             → no-op (could reorder later)
    //   mission-*        → same section        → no-op (already there)
    const srcKind = src.kind;       // 'project' | 'mission'
    const srcSection = src.section; // 'mission-active' | 'mission-inactive' | 'project' (set in onDragStart)

    if (srcKind === 'project' && (targetSection === 'mission-active' || targetSection === 'mission-inactive')) {
        // Promote project → mission (always lands active; status set by promote cmd)
        await postMissionAction('promote', src.repo, {});
    } else if (srcKind === 'mission' && srcSection === 'mission-active' && targetSection === 'mission-inactive') {
        // Active → inactive: toggle off
        await postMissionAction('toggle', src.repo, {});
    } else if (srcKind === 'mission' && srcSection === 'mission-inactive' && targetSection === 'mission-active') {
        // Inactive → active: toggle on
        await postMissionAction('toggle', src.repo, {});
    } else if (srcKind === 'mission' && targetSection === 'project') {
        // Any mission → project (demote). Preserves entry as inactive per cmd_demote fix.
        await postMissionAction('demote', src.repo, {});
    }
    // All other cases (project→project, mission→same section) are no-ops by design.
}

// Reorder within active missions by drag-rearrange: drag onto another mission card → move dragged to that position
function onDragOverMissionCard(e) {
    if (!_dragSrc || _dragSrc.kind !== 'mission') return;
    const targetCard = e.target.closest('.repo-card.mission-card');
    if (!targetCard) return;
    // Don't allow dropping onto yourself (target is the source card being dragged)
    if (targetCard.classList.contains('dragging')) return;
    // Highlight the target card as a reorder target
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    targetCard.style.outline = '2px solid var(--gold)';
}

function onDragLeaveMissionCard(e) {
    const targetCard = e.target.closest('.repo-card.mission-card');
    if (targetCard && !targetCard.contains(e.relatedTarget)) {
        targetCard.style.outline = '';
    }
}

async function onDropOnMissionCard(e) {
    if (!_dragSrc || _dragSrc.kind !== 'mission') return;
    const targetCard = e.target.closest('.repo-card.mission-card');
    if (!targetCard) return;
    const targetRepo = targetCard.getAttribute('data-repo');
    if (!targetRepo || targetRepo === _dragSrc.repo) return;
    e.preventDefault();
    targetCard.style.outline = '';
    // Build new order: dragSrc moves to targetRepo's position
    const state = _missionsStateCache || {};
    const missions = state.missions || {};
    // Current display order: sort by priority then order (matches render)
    const ordered = Object.keys(missions)
        .filter(n => missions[n] && missions[n].status !== 'deleted')
        .sort((a, b) => {
            const pa = missions[a].priority || 99, pb = missions[b].priority || 99;
            if (pa !== pb) return pa - pb;
            const oa = missions[a].order || 999, ob = missions[b].order || 999;
            if (oa !== ob) return oa - ob;
            return a.localeCompare(b);
        });
    const srcIdx = ordered.indexOf(_dragSrc.repo);
    let tgtIdx = ordered.indexOf(targetRepo);
    if (srcIdx === -1 || tgtIdx === -1) return;
    // Remove src from list, insert at tgtIdx
    ordered.splice(srcIdx, 1);
    if (srcIdx < tgtIdx) tgtIdx--;
    ordered.splice(tgtIdx, 0, _dragSrc.repo);
    _dragSrc = null;
    await postMissionAction('reorder-missions', null, { order: ordered });
}

const _missionActionInFlight = new Set();

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderRServerPanel(rData) {
    if (!rData) return;
    
    const system = rData.system || {};
    const upVal = document.getElementById('r-up-val');
    const memVal = document.getElementById('r-mem-val');
    const diskVal = document.getElementById('r-disk-val');
    
    if (upVal) upVal.innerHTML = system.uptime?.ok ? system.uptime.output : '<span style="color:var(--terracotta)">Error</span>';
    if (memVal) {
        if (system.free_h?.ok) {
            const lines = system.free_h.output.split('\n');
            const memLine = lines.find(l => l.startsWith('Mem:'));
            memVal.textContent = memLine ? memLine : system.free_h.output;
        } else {
            memVal.innerHTML = '<span style="color:var(--terracotta)">Error</span>';
        }
    }
    if (diskVal) {
        if (system.df_h?.ok) {
            const lines = system.df_h.output.split('\n');
            const rootLine = lines.find(l => l.includes('/'));
            diskVal.textContent = rootLine ? rootLine : system.df_h.output;
        } else {
            diskVal.innerHTML = '<span style="color:var(--terracotta)">Error</span>';
        }
    }
    
    const dockerStatusTbody = document.getElementById('r-docker-status-tbody');
    if (dockerStatusTbody) {
        if (rData.docker_ps?.ok && rData.docker_ps.output) {
            const lines = rData.docker_ps.output.split('\n');
            dockerStatusTbody.innerHTML = lines.map(line => {
                const parts = line.split('\t');
                if (parts.length < 2) return '';
                const name = parts[0];
                const status = parts[1];
                const ports = parts[2] || '—';
                const isRunning = status.toLowerCase().includes('up');
                const dotClass = isRunning ? 'green' : 'red';
                return `
                    <tr>
                        <td><strong>${name}</strong></td>
                        <td>
                            <div class="docker-status-col">
                                <span class="status-dot ${dotClass}"></span>
                                <span>${status}</span>
                            </div>
                        </td>
                        <td style="font-family: 'Share Tech Mono', monospace; font-size: 0.78rem;">${ports}</td>
                    </tr>
                `;
            }).join('');
        } else {
            dockerStatusTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--terracotta); font-style:italic;">Connection error or no containers</td></tr>`;
        }
    }
    
    const dockerImagesTbody = document.getElementById('r-docker-images-tbody');
    if (dockerImagesTbody) {
        if (rData.docker_images?.ok && rData.docker_images.output) {
            const lines = rData.docker_images.output.split('\n');
            dockerImagesTbody.innerHTML = lines.map(line => {
                const parts = line.split('\t');
                if (parts.length < 3) return '';
                const repo = parts[0];
                const tag = parts[1];
                const size = parts[2];
                return `
                    <tr>
                        <td><strong>${repo}</strong></td>
                        <td style="font-family: 'Share Tech Mono', monospace; font-size: 0.78rem;">${tag}</td>
                        <td style="font-family: 'Share Tech Mono', monospace; font-size: 0.78rem;">${size}</td>
                    </tr>
                `;
            }).join('');
        } else {
            dockerImagesTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--terracotta); font-style:italic;">Connection error or no images</td></tr>`;
        }
    }
}

// ── r-server iframe: load / error / retry + reachability ping ───────────────
// The iframe points at http://100.84.224.18:8383 (r-server Homepage), cross-origin.
// We can't introspect its contents, so reachability is decided by: (a) the
// iframe element's own `load` event, and (b) a periodic no-cors fetch probe.
// The error overlay only shows when BOTH say it's down.

const R_SERVER_HOMEPAGE = 'http://100.84.224.18:8383';
let _iframeLoaded = false;

function _setRServerPing(state, text) {
    const wrap = document.getElementById('r-server-ping');
    const label = document.getElementById('r-server-ping-text');
    if (wrap) wrap.className = 'ping-indicator ' + state; // ok | down | checking
    if (label) label.textContent = text;
}
function _showIframeOverlay(show) {
    const overlay = document.getElementById('iframe-error-overlay');
    if (overlay) overlay.classList.toggle('visible', show);
}

function onIframeLoad() {
    _iframeLoaded = true;
    _showIframeOverlay(false);
    _setRServerPing('ok', 'reachable');
}

// Kept for the inline onerror= hook; real failure detection is probeRServer().
function onIframeError() { probeRServer(); }

function retryIframe() {
    const iframe = document.getElementById('homepage-iframe');
    if (!iframe) return;
    _iframeLoaded = false;
    _setRServerPing('checking', 'checking…');
    _showIframeOverlay(false);
    iframe.src = R_SERVER_HOMEPAGE + '/?_r=' + Date.now();
    setTimeout(probeRServer, 1500);
}

async function probeRServer() {
    try {
        await fetch(R_SERVER_HOMEPAGE, { mode: 'no-cors', cache: 'no-store' });
        onIframeLoad();
    } catch {
        // Only declare failure if the iframe element also never fired `load`.
        if (!_iframeLoaded) {
            _showIframeOverlay(true);
            _setRServerPing('down', 'unreachable');
        }
    }
}



// ── Boot ───────────────────────────────────────────────────────────────────

let isFetching = false;

async function loadAll() {
    if (isFetching) return;
    isFetching = true;
    document.getElementById('refreshRing').classList.add('on');

    // Instant paint from last-known agent cache while the fetch runs.
    const firstNode = document.getElementById('node-aarz');
    if (firstNode && !firstNode.innerHTML.trim()) {
        renderCards(AGENTS.map(a => ({ a, d: getCached(a.id) })));
    }

    // All collector outputs are independent JSON files — fetch them together.
    const [agentsJson, healthData, reposData, rServerData, missionsJson] =
        await Promise.all([
            loadAgentsJson(),
            fetchJSON('/agent-dashboard/health.json'),
            fetchJSON('/agent-dashboard/repos.json'),
            fetchJSON('/agent-dashboard/r_server_info.json'),
            fetchJSON('/agent-dashboard/missions.json'),
        ]);

    // Agent cards from agents.json
    AGENTS.forEach(a => {
        const d = getAgentData(a.id);
        setCache(a.id, d);
        updateCard(a, d);
    });
    updateStatsCounts();
    updateTotalSessionCounts();
    updateStaleBanner();

    if (healthData) renderStatsPanel(healthData);
    if (reposData) renderMissions(reposData);
    if (rServerData) renderRServerPanel(rServerData);
    if (missionsJson) { latestMissionsJson = missionsJson; updateCronStats(); }

    document.getElementById('refreshRing').classList.remove('on');
    isFetching = false;
    drawTreeLines();
}

// Amber strip when the background collector output goes stale (collector down).
function updateStaleBanner() {
    let el = document.getElementById('data-stale-banner');
    if (!el) {
        el = document.createElement('div');
        el.id = 'data-stale-banner';
        el.className = 'stale-banner';
        el.innerHTML = '<span class="stale-banner-icon">⚠</span><span></span>';
        document.body.appendChild(el);
    }
    const ageMs = agentsDataAgeMs();
    if (ageMs > STALE_DATA_MS && isFinite(ageMs)) {
        el.querySelector('span:last-child').textContent =
            `Live data stale — collector last ran ${formatAge(ageMs)}. Check agent-dashboard-collector.service.`;
        el.classList.add('visible');
    } else {
        el.classList.remove('visible');
    }
}


// ── Floating particles (Forest soot sprites / warm fireflies) ────────────────
// Perf: this dashboard runs 24/7. Skip entirely under prefers-reduced-motion,
// pause while the tab is hidden, and cap the live particle count.

const REDUCED_MOTION = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const MAX_PARTICLES = 14;

function spawnParticle() {
    if (REDUCED_MOTION || document.hidden) return;
    if (document.querySelectorAll('.particle').length >= MAX_PARTICLES) return;
    const isOrb = Math.random() > 0.75;
    const p = document.createElement('div');
    p.className = isOrb ? 'particle orb' : 'particle star';
    p.style.left = (Math.random() * 100) + 'vw';

    if (isOrb) {
        // Large soft glowing warm ambient orb
        const size = 60 + Math.random() * 80;
        p.style.width = size + 'px';
        p.style.height = size + 'px';
        p.style.animationDuration = (22 + Math.random() * 8) + 's';
        
        const colors = [
            'rgba(196, 154, 108, 0.05)',  // Warm gold
            'rgba(126, 181, 166, 0.04)',  // Cozy sage
            'rgba(139, 188, 204, 0.04)'   // Soft sky
        ];
        p.style.background = colors[Math.floor(Math.random() * colors.length)];
        p.style.filter = 'blur(20px)';
    } else {
        // Soft drifting forest firefly star
        const size = 1.5 + Math.random() * 2.5;
        p.style.width = size + 'px';
        p.style.height = size + 'px';
        p.style.borderRadius = '50%';
        p.style.animationDuration = (12 + Math.random() * 8) + 's';
        
        const colors = ['#c49a6c', '#7eb5a6', '#f5f0e6', '#8bbccc'];
        p.style.background = colors[Math.floor(Math.random() * colors.length)];
        p.style.boxShadow = `0 0 6px ${p.style.background}`;
    }
    
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 25000);
}

// ── Dashboard uptime ticker ─────────────────────────────────────────────────
const dashboardStartTime = Date.now();
function updateUptime() {
    const elapsed = Date.now() - dashboardStartTime;
    const h = Math.floor(elapsed / 3600000);
    const m = Math.floor((elapsed % 3600000) / 60000);
    const s = Math.floor((elapsed % 60000) / 1000);
    const el = document.getElementById('dashboard-uptime');
    if (el) {
        // Rail is icon-width — show a glyph, full value on hover.
        el.textContent = '⏱';
        el.title = `Dashboard open ${h}h ${m}m ${s}s`;
    }
}
setInterval(updateUptime, 1000);
updateUptime();

// Debounced tree redraw — skip when the Agents panel isn't visible.
let _treeTimer = null;
function scheduleTreeRedraw() {
    clearTimeout(_treeTimer);
    _treeTimer = setTimeout(() => {
        const panel = document.getElementById('panel-agents');
        if (panel && panel.classList.contains('active')) drawTreeLines();
    }, 120);
}

// ── Boot ───────────────────────────────────────────────────────────────────

window.addEventListener('load', () => {
    // Open tab from #hash, else last-used tab
    const TABS = ['agents', 'stats', 'missions', 'r-server'];
    const fromHash = location.hash.slice(1);
    let initial = null;
    if (TABS.includes(fromHash)) initial = fromHash;
    else { try { initial = localStorage.getItem('dash_tab'); } catch {} }
    if (initial && document.getElementById('panel-' + initial)) switchTab(initial);
    window.addEventListener('hashchange', () => {
        const h = location.hash.slice(1);
        if (TABS.includes(h)) switchTab(h);
    });

    loadAll();
    setInterval(loadAll, REFRESH_MS);

    if (!REDUCED_MOTION) {
        setInterval(spawnParticle, 1600);
        for (let i = 0; i < 12; i++) setTimeout(spawnParticle, i * 600);
    }

    wireMissionModals();

    window.addEventListener('resize', scheduleTreeRedraw);
    drawTreeLines();
    setTimeout(drawTreeLines, 500);

    // r-server iframe: attach the load listener via JS (the inline onload= can
    // race this script), then probe now + periodically.
    const rIframe = document.getElementById('homepage-iframe');
    if (rIframe) rIframe.addEventListener('load', onIframeLoad);
    _setRServerPing('checking', 'checking…');
    probeRServer();
    setInterval(probeRServer, 60000);

    // Refresh card relative timers every 30s (no network) — only while the
    // Agents panel is actually visible.
    setInterval(() => {
        const panel = document.getElementById('panel-agents');
        if (isFetching || !panel || !panel.classList.contains('active')) return;
        AGENTS.forEach(a => updateCard(a, getCached(a.id)));
        drawTreeLines();
    }, 30000);
});
