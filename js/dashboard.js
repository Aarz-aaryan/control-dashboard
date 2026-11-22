// ── Control Dashboard — client logic ────────────────────────────────────────
// Split out of index.html (was a 174 KB inline blob). Classic script (not a
// module) so the inline onclick= handlers in index.html keep working.

// Visual metadata per agent. The roster itself (who exists) is discovered from
// agents.json, built from the live Pi runtime and configured session stores.
// The collector owns discovery — this map just supplies a
// colour/icon/role, with a sensible fallback for anything not listed.
const AGENT_META = {
    aarz:    { name: 'Aarz · Pi', role: 'Discord Assistant', color: '#c49a6c', icon: 'aarz.svg' },
    'pi-scheduler': { name: 'Pi Scheduler', role: 'Cron Jobs & Scripts', color: '#b5a0d9', icon: 'pi.svg' },
    'pi-cli': { name: 'Pi CLI', role: 'Coding Sessions', color: '#8bbccc', icon: 'pi.svg' },
    'pi-voice': { name: 'Voice · Pi', role: 'Browser & Echo Session Store', color: '#7eb5a6', icon: 'pi.svg' },
    'pi-whatsapp': { name: 'WhatsApp · Pi', role: 'Personal Assistant', color: '#89bc8b', icon: 'pi.svg' },
    agy:     { name: 'agy Utility',     role: 'CLI Tool Invocations · Not an Agent',   color: '#8bbccc', icon: 'agy.svg' },
};
function agentMeta(id) {
    const m = AGENT_META[id] || {};
    const color = m.color || '#8a8a8a';
    return {
        id,
        name: m.name || id,
        role: m.role || 'Agent',
        color,
        dim: color + '26', // ~15% alpha
        icon: m.icon || 'aarz.svg',
    };
}

// Built from agents.json on each load (aarz first, then discovery order).
let AGENTS = Object.keys(AGENT_META).map(agentMeta);

function rebuildRoster() {
    const ids = _agentsJson && _agentsJson.agents ? Object.keys(_agentsJson.agents) : null;
    if (!ids || !ids.length) return;
    ids.sort((a, b) => (a === 'aarz' ? -1 : b === 'aarz' ? 1 : a.localeCompare(b)));
    AGENTS = ids.map(agentMeta);
    // Make sure a tree node exists for every non-root agent.
    const row = document.getElementById('agent-row');
    if (row) {
        const want = AGENTS.filter(a => a.id !== 'aarz').map(a => a.id);
        if (want.join(',') !== [...row.children].map(c => c.id.replace('node-', '')).join(',')) {
            row.innerHTML = want.map(id => `<div class="tree-node" id="node-${id}"></div>`).join('');
        }
    }
}

const WORKING_MS = 4 * 60 * 60 * 1000;
const REFRESH_MS = 30 * 1000;
const CACHE_TTL_MS = 60 * 1000;
const STALE_DATA_MS = 3 * 60 * 1000;     // collector output older than this = stale

// ── Fetch helpers ──────────────────────────────────────────────────────────

async function fetchJSON(url) {
    try {
        const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
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
// No browser access to private runtime databases or session transcripts.

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

// Per-integration activity from Pi runtime history and JSONL session metadata.
function getAgentData(id) {
    const a = (_agentsJson && _agentsJson.agents && _agentsJson.agents[id]) || null;
    if (!a) return { status: 'dormant', ts: 0, sessions_today: 0, sessions_24h: 0, recent: [], error: 'Integration telemetry unavailable' };
    return {
        status: a.status || 'dormant',
        ts: a.last_active_ms || 0,
        sessions_today: a.sessions_today || 0,
        sessions_24h: a.sessions_24h || 0,
        last_title: a.last_title || null,
        last_source: a.last_source || null,
        recent: a.recent || [],
        metric_unit: a.metric_unit || 'sessions',
        running: a.running || 0,
        queued: a.queued || 0,
        error: a.error || null,
    };
}

function telemetryAgeMs(generated, now = Date.now()) {
    const at = Date.parse(generated);
    const age = now - at;
    return Number.isFinite(age) && age >= -5000 ? Math.max(0, age) : Infinity;
}

function agentsDataAgeMs() {
    return telemetryAgeMs(_agentsJson?._generated_at);
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
    if (!Number.isFinite(ms) || !ms || ms < 0) return null;
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (s < 60)    return s + 's ago';
    if (m < 60)    return m + 'm ' + (s % 60) + 's ago';
    if (h < 24)    return h + 'h ' + (m % 60) + 'm ago';
    if (d < 30)    return d + 'd ' + (h % 24) + 'h ago';
    if (d < 365)   return Math.floor(d / 30) + 'mo ago';
    return Math.floor(d / 365) + 'y ago';
}

function exactTime(ms) {
    return ms ? new Date(ms).toLocaleString() : '—';
}

// ── Operational Health & Renderer ──────────────────────────────────────────

function getAgentHealth(id, data, system) {
    const error = data?.error;
    const working = (data?.running || 0) > 0;
    const isRecent = data?.status === 'active';
    const services = system?.services || [];
    const runtime = system?.runtime || {};

    let isHealthy = true;
    let status = 'standby'; // 'running', 'active', 'standby', 'degraded', 'down'
    let statusLabel = 'ONLINE · READY';
    let issueDetail = '';
    let daemonInfo = '';

    if (error || agentsDataAgeMs() > STALE_DATA_MS) {
        return {
            isHealthy: false,
            status: 'down',
            statusLabel: 'UNAVAILABLE',
            issueDetail: error || 'Collector telemetry stale or unavailable',
            daemonInfo: 'Runtime data unavailable',
            isWorking: false
        };
    }

    const required = {
        aarz: ['aarz-agent.service', 'modelrelay.service'],
        'pi-scheduler': ['aarz-agent.service', 'modelrelay.service'],
        'pi-voice': ['pi-live-voice.service', 'whatsapp-stt.service', 'whatsapp-tts.service', 'modelrelay.service'],
        'pi-whatsapp': ['whatsapp-pi.service', 'whatsapp-stt.service', 'whatsapp-tts.service', 'modelrelay.service'],
    }[id] || [];
    const unavailable = required.find(unit => services.find(s => s.unit === unit)?.state !== 'active');
    const needsRuntime = id === 'aarz' || id === 'pi-scheduler';
    if (unavailable || needsRuntime && (runtime.discord_connected !== true || !Number.isFinite(runtime.heartbeat_age_s) || runtime.heartbeat_age_s < 0 || runtime.heartbeat_age_s >= 90)) {
        return {isHealthy:false, status:'degraded', statusLabel:'HEALTH UNVERIFIED',
            issueDetail:unavailable ? `${unavailable}: inactive or unknown` : 'Discord disconnected or heartbeat stale/missing',
            daemonInfo:'Service/runtime health could not be confirmed', isWorking:false};
    }

    switch (id) {
        case 'aarz': {
            const svc = services.find(s => s.unit === 'aarz-agent.service');
            const svcOk = svc?.state === 'active';
            const discordOk = runtime.discord_connected === true;
            const heartbeatAge = runtime.heartbeat_age_s;
            const heartbeatOk = Number.isFinite(heartbeatAge) && heartbeatAge >= 0 && heartbeatAge < 90;

            if (!svcOk) {
                isHealthy = false;
                status = 'down';
                statusLabel = 'OFFLINE · STOPPED';
                issueDetail = 'aarz-agent.service is stopped';
                daemonInfo = 'aarz-agent.service: inactive';
            } else if (!discordOk) {
                isHealthy = false;
                status = 'degraded';
                statusLabel = 'DISCONNECTED';
                issueDetail = 'Discord gateway disconnected';
                daemonInfo = 'Discord: disconnected';
            } else if (!heartbeatOk) {
                isHealthy = false;
                status = 'degraded';
                statusLabel = 'STALE HEARTBEAT';
                issueDetail = `Heartbeat is ${heartbeatAge}s old (>90s)`;
                daemonInfo = `Heartbeat: ${heartbeatAge}s ago`;
            } else if (working) {
                status = 'running';
                statusLabel = 'RUNNING TASK';
                daemonInfo = 'Discord bot · executing task';
            } else if (isRecent) {
                status = 'active';
                statusLabel = 'ONLINE · ACTIVE';
                daemonInfo = 'Discord bot · recent interaction';
            } else {
                status = 'standby';
                statusLabel = 'ONLINE · READY';
                daemonInfo = 'Discord bot · listening & ready';
            }
            break;
        }

        case 'pi-scheduler': {
            const svc = services.find(s => s.unit === 'aarz-agent.service');
            const svcOk = svc ? svc.state === 'active' : true;
            const sched = system?.schedules;
            const failedJobs = telemetryAgeMs(latestMissionsJson?._generated_at) <= STALE_DATA_MS
                ? (latestMissionsJson.cron || []).filter(j => j.status === 'ACTIVE' && (j.last_status === 'error' || j.last_error)).length : 0;

            if (!svcOk) {
                isHealthy = false;
                status = 'down';
                statusLabel = 'OFFLINE · STOPPED';
                issueDetail = 'Scheduler runner service inactive';
                daemonInfo = 'aarz-agent.service: inactive';
            } else if (telemetryAgeMs(latestMissionsJson?._generated_at) > STALE_DATA_MS) {
                isHealthy = false;
                status = 'degraded';
                statusLabel = 'SCHEDULE DATA STALE';
                issueDetail = 'Scheduled-job results are stale or unavailable; runner service is active';
                daemonInfo = issueDetail;
            } else if (failedJobs) {
                isHealthy = false;
                status = 'degraded';
                statusLabel = 'JOB FAILURES';
                issueDetail = `${failedJobs} enabled schedules have last-run errors; runner service is active`;
                daemonInfo = issueDetail;
            } else if (working) {
                status = 'running';
                statusLabel = 'RUNNING JOB';
                daemonInfo = 'Executing cron/scheduled task';
            } else if (isRecent) {
                status = 'active';
                statusLabel = 'ONLINE · ACTIVE';
                daemonInfo = `${sched ? sched.enabled : 'unknown'} enabled schedules · recent executions`;
            } else {
                status = 'standby';
                statusLabel = 'ONLINE · SCHEDULED';
                daemonInfo = `${sched ? sched.enabled : 'unknown'} schedules enabled`;
            }
            break;
        }

        case 'pi-voice': {
            const svc = services.find(s => s.unit === 'pi-live-voice.service');
            const svcOk = svc ? svc.state === 'active' : true;
            const echo = system?.echo || {};

            if (!svcOk) {
                isHealthy = false;
                status = 'down';
                statusLabel = 'OFFLINE · STOPPED';
                issueDetail = 'pi-live-voice.service inactive';
                daemonInfo = 'pi-live-voice.service: inactive';
            } else if (working || echo.busy) {
                status = 'running';
                statusLabel = 'VOICE IN CALL';
                daemonInfo = 'Live speech session in progress';
            } else if (isRecent) {
                status = 'active';
                statusLabel = 'ONLINE · ACTIVE';
                daemonInfo = 'Voice Gateway: active · GPU speech ready';
            } else {
                status = 'standby';
                statusLabel = 'ONLINE · READY';
                daemonInfo = 'Voice Gateway: active · Echo waiting';
            }
            break;
        }

        case 'pi-whatsapp': {
            const svc = services.find(s => s.unit === 'whatsapp-pi.service');
            const svcOk = svc ? svc.state === 'active' : true;

            if (!svcOk) {
                isHealthy = false;
                status = 'down';
                statusLabel = 'OFFLINE · STOPPED';
                issueDetail = 'whatsapp-pi.service inactive';
                daemonInfo = 'whatsapp-pi.service: inactive';
            } else if (working) {
                status = 'running';
                statusLabel = 'RUNNING TASK';
                daemonInfo = 'WhatsApp assistant · processing';
            } else if (isRecent) {
                status = 'active';
                statusLabel = 'ONLINE · ACTIVE';
                daemonInfo = 'WhatsApp assistant · recent chats';
            } else {
                status = 'standby';
                statusLabel = 'ONLINE · READY';
                daemonInfo = 'whatsapp-pi daemon: active · listening';
            }
            break;
        }

        case 'pi-cli': {
            if (working) {
                status = 'running';
                statusLabel = 'RUNNING SESSION';
                daemonInfo = 'Coding CLI session active';
            } else if (isRecent) {
                status = 'active';
                statusLabel = 'ONLINE · ACTIVE';
                daemonInfo = 'Pi coding CLI · recent sessions';
            } else {
                status = 'standby';
                statusLabel = 'ONLINE · READY';
                daemonInfo = 'Pi coding CLI harness · ready';
            }
            break;
        }

        case 'agy': {
            if (working) {
                status = 'running';
                statusLabel = 'EXECUTING RUN';
                daemonInfo = 'Antigravity CLI tool executing';
            } else if (isRecent) {
                status = 'active';
                statusLabel = 'ONLINE · ACTIVE';
                daemonInfo = 'Antigravity CLI tool · active runs';
            } else {
                status = 'standby';
                statusLabel = 'ONLINE · READY';
                daemonInfo = 'Antigravity CLI tool · ready';
            }
            break;
        }

        default: {
            if (working) {
                status = 'running';
                statusLabel = 'RUNNING TASK';
                daemonInfo = 'Task executing';
            } else if (isRecent) {
                status = 'active';
                statusLabel = 'ONLINE · ACTIVE';
                daemonInfo = 'Recent activity';
            } else {
                status = 'standby';
                statusLabel = 'ONLINE · READY';
                daemonInfo = 'Agent standing by';
            }
            break;
        }
    }

    return {
        isHealthy,
        status,
        statusLabel,
        issueDetail,
        daemonInfo,
        isWorking: working
    };
}

function cardHTML(agent, data) {
    const now = Date.now();
    const ts = data?.ts || 0;
    const system = _agentsJson?.system;
    const health = getAgentHealth(agent.id, data, system);
    const ageStr = ts ? formatAge(now - ts) : null;
    const recent = data?.recent || [];

    const lastLabel = data?.last_title || data?.last_source || '—';

    const recentHtml = recent.length ? `
    <div class="session-tooltip">
      <div class="session-tooltip-title">Recent Activity Logs</div>
      ${recent.slice(0, 5).map(r => `
      <div class="session-tooltip-row">
        <span class="st-name">${escapeHtml(r.title || r.source || '—')}</span>
        <span class="st-time">${formatAge(now - r.ts) || ''}</span>
      </div>`).join('')}
    </div>` : '';

    const statusClass = health.isHealthy ? `health-${health.status}` : 'health-down';
    const isWorking = health.isWorking;
    const dotClass = !health.isHealthy ? 'down' : (isWorking ? 'working' : (health.status === 'active' ? 'active' : 'ready'));
    const pillClass = !health.isHealthy ? 'pill-down' : (health.status === 'running' ? 'pill-running' : (health.status === 'active' ? 'pill-active' : (health.status === 'standby' ? 'pill-standby' : 'pill-ready')));

    return `<div class="card ${statusClass} ${isWorking ? 'active-core' : ''}" id="card-${agent.id}" style="--agent-color: ${agent.color}; --agent-dim: ${agent.dim};">
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
    <div class="health-dot ${dotClass}" title="${escapeHtml(health.statusLabel)}"></div>
  </div>

  <div class="status-row">
    <span class="health-pill ${pillClass}">
      <span class="pill-dot"></span>
      ${escapeHtml(health.statusLabel)}
    </span>
    <span class="time-ago" title="${exactTime(ts)}">${ageStr || (health.isHealthy ? 'Standing by' : 'No data')}</span>
  </div>

  <div class="card-daemon-chip" title="${escapeHtml(health.daemonInfo)}">
    <span class="daemon-icon">⚡</span>
    <span class="daemon-text">${escapeHtml(health.daemonInfo)}</span>
  </div>

  <div class="agent-metrics" title="${escapeHtml(data?.metric_unit || 'sessions')} recorded in each period.">
    <div class="agent-metric">
      <span class="am-num">${data?.sessions_today ?? 0}</span>
      <span class="am-lbl">${escapeHtml(data?.metric_unit || 'sessions')} today</span>
    </div>
    <div class="agent-metric">
      <span class="am-num">${data?.sessions_24h ?? 0}</span>
      <span class="am-lbl">24 hours</span>
    </div>
  </div>

  ${data?.queued ? `<div class="card-queued-badge">${data.queued} queued in runtime</div>` : ''}

  <div class="card-foot">
    <span class="foot-label">Last:</span>
    <span class="foot-value" title="${escapeHtml(lastLabel)}">${escapeHtml(lastLabel)}</span>
  </div>
  ${recentHtml}
</div>`;
}

// ── Quick Filter & Instant Search ──────────────────────────────────────────

let _currentAgentFilter = 'all';
let _agentSearchQuery = '';

function filterAgents(filterKey) {
    _currentAgentFilter = filterKey;
    document.querySelectorAll('.agents-filter-pills .filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === filterKey);
    });
    applyAgentFilters();
}

function onAgentSearch(query) {
    _agentSearchQuery = (query || '').trim().toLowerCase();
    const clearBtn = document.getElementById('agents-search-clear');
    if (clearBtn) clearBtn.style.display = _agentSearchQuery ? 'block' : 'none';
    applyAgentFilters();
}

function clearAgentSearch() {
    const input = document.getElementById('agents-search-input');
    if (input) input.value = '';
    onAgentSearch('');
}

function applyAgentFilters() {
    const container = document.querySelector('.agents-fleet-grid');
    if (!container) return;
    const cards = container.querySelectorAll('.card');
    let visibleCount = 0;

    cards.forEach(card => {
        const id = card.id.replace('card-', '');
        const data = getAgentData(id);
        const health = getAgentHealth(id, data, _agentsJson?.system);

        let matchesFilter = true;
        if (_currentAgentFilter === 'healthy') matchesFilter = health.isHealthy;
        else if (_currentAgentFilter === 'active') matchesFilter = (health.status === 'active' || health.status === 'running');
        else if (_currentAgentFilter === 'standby') matchesFilter = (health.status === 'standby');
        else if (_currentAgentFilter === 'issues') matchesFilter = (!health.isHealthy || health.status === 'down' || health.status === 'degraded');

        let matchesSearch = true;
        if (_agentSearchQuery) {
            const text = (card.textContent || '').toLowerCase();
            matchesSearch = text.includes(_agentSearchQuery);
        }

        const isVisible = matchesFilter && matchesSearch;
        const parentNode = card.closest('.tree-node') || card;
        parentNode.style.display = isVisible ? '' : 'none';
        if (isVisible) visibleCount++;
    });

    const emptyState = document.getElementById('agents-empty-state');
    if (emptyState) emptyState.style.display = visibleCount === 0 ? 'block' : 'none';
}

function updateMasterStatus() {
    const masterEl = document.getElementById('agents-master-status');
    if (!masterEl) return;

    const system = _agentsJson?.system;
    const stale = agentsDataAgeMs() > STALE_DATA_MS;

    const agentsList = AGENTS.map(a => {
        const d = getAgentData(a.id);
        const h = getAgentHealth(a.id, d, system);
        return { agent: a, data: d, health: h };
    });

    const total = agentsList.length;
    const healthyCount = agentsList.filter(x => x.health.isHealthy).length;
    const activeCount = agentsList.filter(x => x.health.status === 'active' || x.health.status === 'running').length;
    const standbyCount = agentsList.filter(x => x.health.status === 'standby').length;
    const issues = agentsList.filter(x => !x.health.isHealthy || x.health.status === 'down' || x.health.status === 'degraded');
    const infrastructureIssues = (system?.services || []).filter(s => s.state !== 'active');
    const issueCount = issues.length + infrastructureIssues.length;

    const elAll = document.getElementById('filter-count-all');
    if (elAll) elAll.textContent = total;
    const elHealthy = document.getElementById('filter-count-healthy');
    if (elHealthy) elHealthy.textContent = healthyCount;
    const elActive = document.getElementById('filter-count-active');
    if (elActive) elActive.textContent = activeCount;
    const elStandby = document.getElementById('filter-count-standby');
    if (elStandby) elStandby.textContent = standbyCount;
    const elIssues = document.getElementById('filter-count-issues');
    if (elIssues) {
        elIssues.textContent = issueCount;
        elIssues.className = 'filter-count ' + (issueCount > 0 ? 'alert-active' : 'alert-zero');
    }

    window.DashboardAlerts?.set('agents', 'fleet', stale ? 'Agent telemetry stale / unavailable' : issueCount ? `${issueCount} health issues — see fleet panel` : null, stale ? 'warning' : 'error');

    const updateText = document.getElementById('agents-updated-text');
    if (updateText) {
        if (stale) {
            updateText.textContent = 'Telemetry unverified · ' + (formatAge(agentsDataAgeMs()) || 'missing / invalid timestamp');
        } else {
            updateText.textContent = 'Live Telemetry · ' + (formatAge(agentsDataAgeMs()) || 'just now');
        }
    }
    const liveBadge = document.getElementById('agents-live-badge');
    if (liveBadge) liveBadge.classList.toggle('system-bad', stale);

    const rt = system?.runtime || {};
    const discordOk = !stale && rt.discord_connected === true;
    const schedOk = !stale && (system?.schedules?.enabled || 0) > 0;
    const voiceOk = !stale && system?.services?.find(s => s.unit === 'pi-live-voice.service')?.state === 'active';
    const waOk = !stale && system?.services?.find(s => s.unit === 'whatsapp-pi.service')?.state === 'active';

    if (issueCount === 0 && !stale) {
        masterEl.className = 'master-status-card status-all-green';
        masterEl.innerHTML = `
            <div class="master-status-main">
                <div class="master-status-indicator">
                    <span class="status-pulse-ring"></span>
                    <span class="status-core-dot"></span>
                </div>
                <div class="master-status-info">
                    <div class="master-status-badge">SYSTEM STATUS: OPTIMAL</div>
                    <div class="master-status-title">INTEGRATIONS & SERVICES REPORTING</div>
                    <div class="master-status-sub">${total} integration activity sources reporting; monitored service units are active. Activity history is not a live connection test.</div>
                </div>
            </div>
            <div class="master-status-chips">
                <div class="status-chip chip-green" title="Discord gateway connected and listening">
                    <span class="chip-dot"></span><span class="chip-label">Discord:</span> <strong>Connected</strong>
                </div>
                <div class="status-chip chip-green" title="${system?.schedules?.enabled || 0} scheduled operations enabled">
                    <span class="chip-dot"></span><span class="chip-label">Schedulers:</span> <strong>${system?.schedules?.enabled || 0} Active</strong>
                </div>
                <div class="status-chip chip-green" title="Voice gateway service active, Echo ready">
                    <span class="chip-dot"></span><span class="chip-label">Voice Gateway:</span> <strong>Ready</strong>
                </div>
                <div class="status-chip chip-green" title="WhatsApp-Pi background assistant active">
                    <span class="chip-dot"></span><span class="chip-label">WhatsApp · Pi:</span> <strong>Listening</strong>
                </div>
                <div class="status-chip chip-green" title="Agent-server collector is reporting live data">
                    <span class="chip-dot"></span><span class="chip-label">Telemetry:</span> <strong>Live (30s)</strong>
                </div>
            </div>
        `;
    } else {
        masterEl.className = 'master-status-card status-has-issues';
        const issueDescriptions = [];
        if (stale) issueDescriptions.push('Telemetry collector unverified: ' + (formatAge(agentsDataAgeMs()) || 'missing / invalid timestamp'));
        issues.forEach(x => {
            issueDescriptions.push(`${x.agent.name}: ${x.health.issueDetail || x.health.statusLabel}`);
        });
        infrastructureIssues.forEach(s => issueDescriptions.push(`${s.name || s.unit}: ${s.state || 'unknown'}`));

        masterEl.innerHTML = `
            <div class="master-status-main">
                <div class="master-status-indicator issue-indicator">
                    <span class="status-pulse-ring red"></span>
                    <span class="status-core-dot red"></span>
                </div>
                <div class="master-status-info">
                    <div class="master-status-badge badge-red">ATTENTION REQUIRED</div>
                    <div class="master-status-title">${issueCount > 0 ? `${issueCount} HEALTH ISSUE${issueCount > 1 ? 'S' : ''}` : 'COLLECTOR STALE'}</div>
                    <div class="master-status-sub">${escapeHtml(issueDescriptions.join(' · '))}</div>
                </div>
            </div>
            <div class="master-status-chips">
                <div class="status-chip ${discordOk ? 'chip-green' : 'chip-red'}">
                    <span class="chip-dot"></span><span class="chip-label">Discord:</span> <strong>${stale ? 'Unverified' : discordOk ? 'Connected' : 'Disconnected / unknown'}</strong>
                </div>
                <div class="status-chip ${schedOk ? 'chip-green' : 'chip-red'}">
                    <span class="chip-dot"></span><span class="chip-label">Schedulers:</span> <strong>${stale ? 'Unverified' : (system?.schedules?.enabled || 0) + ' Enabled'}</strong>
                </div>
                <div class="status-chip ${voiceOk ? 'chip-green' : 'chip-red'}">
                    <span class="chip-dot"></span><span class="chip-label">Voice Gateway:</span> <strong>${stale ? 'Unverified' : voiceOk ? 'Ready' : 'Down / unknown'}</strong>
                </div>
                <div class="status-chip ${waOk ? 'chip-green' : 'chip-red'}">
                    <span class="chip-dot"></span><span class="chip-label">WhatsApp · Pi:</span> <strong>${stale ? 'Unverified' : waOk ? 'Ready' : 'Down / unknown'}</strong>
                </div>
                <button class="status-chip-btn" onclick="filterAgents('issues')">Filter Issues Only &rarr;</button>
            </div>
        `;
    }

    applyAgentFilters();
}

function renderSystemOverview() {
    const system = _agentsJson?.system;
    const target = document.getElementById('system-services');
    if (!target) return;
    const stale = agentsDataAgeMs() > STALE_DATA_MS;
    const badServices = system?.services?.filter(s => s.state !== 'active') || [];
    const runtimeOk = system?.runtime?.discord_connected === true && Number.isFinite(system?.runtime?.heartbeat_age_s) && system.runtime.heartbeat_age_s < 90 && system.runtime.heartbeat_age_s >= 0;
    window.DashboardAlerts?.set('stats', 'services', stale || !system ? 'System telemetry stale / unavailable' : badServices.length ? `${badServices.length} service units inactive / unknown` : !runtimeOk ? 'Discord runtime disconnected or heartbeat unverified' : null, stale || !system ? 'warning' : 'error');
    const label = document.getElementById('system-updated');
    if (label) {
        label.textContent = stale ? 'Collector data stale' : 'Updated ' + (formatAge(agentsDataAgeMs()) || 'just now');
        label.classList.toggle('system-bad', stale);
    }
    if (!system) {
        target.textContent = 'Waiting for system inventory from collector…';
        return;
    }
    const services = system.services || [];
    target.innerHTML = services.map(s => `<article class="system-service"><div class="system-service-top"><strong>${escapeHtml(s.name)}</strong><span class="system-state ${s.state === 'active' && !stale ? '' : 'system-bad'}">${stale ? 'STALE' : escapeHtml(s.state.toUpperCase())}</span></div><p>${escapeHtml(s.role)}</p><code>${escapeHtml(s.unit)}</code></article>`).join('');
    const rt = system.runtime || {}, jobs = system.schedules;
    const summaries = [
        ['SERVICE UNITS', `${services.filter(s=>s.state==='active').length} / ${services.length}`, stale ? 'Last collected state' : 'Active on agent-server'],
        ['DISCORD BRIDGE', rt.status || 'Unknown', rt.discord_connected ? 'Gateway connected' : 'Gateway disconnected'],
        ['SCHEDULED JOBS', jobs ? `${jobs.enabled} / ${jobs.total}` : '—', 'Enabled · canonical Pi job store'],
        ['INTEGRATIONS', String(AGENTS.length), 'Activity sources · not subagents'],
    ];
    const summaryEl = document.getElementById('system-summary');
    if (summaryEl) {
        summaryEl.innerHTML = summaries.map(([name,value,detail]) => `<div class="system-summary-card"><label>${name}</label><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`).join('');
    }
    const echo = system.echo || {};
    const states = {'waiting-for-tunnel':'Echo waiting for homescreen tunnel', 'waiting-for-wake-word':'Echo ready · waiting for wake word', 'unavailable':'Echo status unavailable'};
    const echoEl = document.getElementById('system-echo');
    if (echoEl) {
        echoEl.textContent = (stale ? 'Last known: ' : '') + (states[echo.state] || 'Echo: ' + (echo.state || 'unknown')) + ' · Browser: ' + (echo.browser_mode || 'unknown') + (echo.busy ? ' · Echo task running' : '');
    }
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
    updateMasterStatus();
    applyAgentFilters();
    renderSystemOverview();
    drawTreeLines();
}

function updateCard(agent, data) {
    const el = document.getElementById('card-' + agent.id);
    if (el) {
        // Only touching card #agent.id — card sizes don't change, so the tree
        // lines don't need redrawing here. Callers redraw once after a batch.
        el.outerHTML = cardHTML(agent, data);
        updateMasterStatus();
        applyAgentFilters();
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
    // Keep a "/sub" deep-link (e.g. #missions/<repo>) only while on that same tab.
    const cur = location.hash.slice(1).split('/');
    const next = cur[0] === tabId && cur[1] ? `${tabId}/${cur[1]}` : tabId;
    if (location.hash.slice(1) !== next) history.replaceState(null, '', '#' + next);

    if (tabId === 'agents') {
        updateMasterStatus();
        applyAgentFilters();
        setTimeout(drawTreeLines, 80);
    } else if (tabId === 'stats') {
        renderSystemOverview();
    }
}

let latestMissionsJson = null;

// Mission detail (summary / activity / question) maintained by the aarz cron,
// plus the user's staged answers. Both are static JSON served by :8000.
let _missionDetails = {};   // { "<repo>": {summary, activity, question, question_history, github} }
let _missionAnswers = {};   // { "<repo>": {question_id, text, answered_at} }

async function loadMissionExtras() {
    const [det, ans] = await Promise.all([
        fetchJSON('/agent-dashboard/missions_details.json'),
        fetchJSON('/agent-dashboard/missions_answers.json'),
    ]);
    _missionDetails = (det && det.missions) || {};
    _missionAnswers = (ans && ans.answers) || {};
}

// Effective question state for a repo: 'open' | 'answered' | null
function missionQuestion(repo) {
    const q = _missionDetails[repo] && _missionDetails[repo].question;
    if (!q || !q.id) return null;
    const ans = _missionAnswers[repo];
    const answered = ans && ans.question_id === q.id;
    return { ...q, status: answered ? 'answered' : (q.status || 'open'), answer: answered ? ans.text : null,
             answered_at: answered ? ans.answered_at : null };
}

const GH_MARK = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>`;

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
        panel.style.maxHeight = '70vh';
        panel.style.overflowY = 'auto';
        panel.style.opacity = '1';
        isCronPanelOpen = true;
    }
    document.getElementById('cron-jobs-stat')?.setAttribute('aria-expanded', String(isCronPanelOpen));
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
            if (ms >= 0 && typeof formatAge === 'function') {
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
                    <strong style="color: #fff; font-family: 'DM Sans', sans-serif; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(j.name || j.job_id || 'Unnamed job')}</strong>
                    <span style="color: var(--gold); font-size: 0.8rem; font-family: 'Share Tech Mono', monospace; opacity: 0.9;">${escapeHtml(j.schedule || '—')}</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
                    <div style="color: var(--text-muted); font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${escapeHtml(purpose)}</div>
                    <div style="color: var(--text-muted); font-size: 0.75rem; white-space: nowrap; flex-shrink: 0;">${j.status === 'ACTIVE' ? 'Enabled' : 'Paused'} · ${escapeHtml(j.last_status || 'not run')} · Ran: ${escapeHtml(lastRun)}</div>
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
            nameEl.textContent = a.name;
            info.appendChild(nameEl);
            const unitEl = document.createElement('small');
            unitEl.className = 'stats-unit';
            unitEl.textContent = (d.metric_unit || 'sessions') + ' started today';
            info.appendChild(unitEl);
            
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
        const generated = _agentsJson?._generated_at;
        elUpdated.textContent = generated ? `Collected ${new Date(generated).toLocaleTimeString()} · refresh 30s` : 'Collector unavailable';
        elUpdated.classList.toggle('system-bad', agentsDataAgeMs() > STALE_DATA_MS);
    }
}

function updateCronStats() {
    if (!latestMissionsJson) return;
    const cronJobs = latestMissionsJson.cron || [];
    const activeCount = cronJobs.filter(j => j.status === 'ACTIVE').length;
    const pausedCount = cronJobs.filter(j => j.status !== 'ACTIVE').length;
    const failingCount = cronJobs.filter(j => j.last_status === 'error' || j.last_error).length;
    const stale = telemetryAgeMs(latestMissionsJson._generated_at) > STALE_DATA_MS;
    window.DashboardAlerts?.set('stats', 'schedules', stale ? 'Scheduled job results stale / unavailable' : failingCount ? `${failingCount} scheduled jobs with last-run errors` : null, stale ? 'warning' : 'error');

    const elCronCount = document.getElementById('stat-cron-count');
    const elCronActive = document.getElementById('stat-cron-active');
    const elCronPaused = document.getElementById('stat-cron-paused');
    const elBadge = document.getElementById('stat-cron-health-badge');

    if (elCronCount) elCronCount.textContent = activeCount;
    if (elCronActive) elCronActive.textContent = activeCount;
    if (elCronPaused) elCronPaused.textContent = pausedCount;

    // Health badge on the tile — visible without expanding
    if (elBadge) {
        if (stale) {
            elBadge.textContent = 'Job results stale / unavailable';
            elBadge.style.color = 'var(--terracotta)';
            elBadge.style.opacity = '1';
        } else if (failingCount > 0) {
            elBadge.textContent = failingCount === 1 ? '1 failing' : failingCount + ' failing';
            elBadge.style.background = 'rgba(196, 108, 78, 0.15)';
            elBadge.style.color = 'var(--terracotta)';
            elBadge.style.border = '1px solid var(--terracotta)';
            elBadge.style.opacity = '1';
        } else if (cronJobs.length === 0) {
            elBadge.style.opacity = '0';
        } else {
            elBadge.textContent = 'No recorded failures · ' + cronJobs.filter(j => !j.last_run).length + ' never run';
            elBadge.style.background = 'rgba(143, 163, 130, 0.15)';
            elBadge.style.color = 'var(--sage)';
            elBadge.style.border = '1px solid var(--sage)';
            elBadge.style.opacity = '1';
        }
    }

    // Populate the expansion panel list (even when collapsed, so opening is instant)
    renderCronDetails(cronJobs);
}

// Activity totals combine chat turns, job executions and distinct Pi sessions.
function updateTotalSessionCounts() {
    const el = document.getElementById('stat-total-sessions-all');
    if (!el) return;
    const agents = (_agentsJson && _agentsJson.agents) || {};
    const total = Object.values(agents).reduce((acc, a) => acc + (a.sessions_24h || 0), 0);
    el.textContent = total;
}

// ── Dynamic renderers for panels ───────────────────────────────────────────

function renderStatsPanel(h) {
    renderResourceStats(h);
}

// Retained legacy markup renderer; resource stats now use escaped, quality-aware rows.
function renderLegacyStatsPanel(h) {
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
                <div class="health-item-hdr"><span>Pi Runtime · Discord & Scheduler</span><span class="status-dot ${local.pi === 'Running' ? 'green' : 'red'}"></span></div>
                <div class="health-item-value">${escapeHtml(local.pi || 'Unavailable')} · Discord ${local.pi_runtime?.discord_connected ? 'connected' : 'disconnected'}<br>Heartbeat: ${local.pi_runtime?.heartbeat_age_s ?? '—'}s ago</div>
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

let _lastReposEnvelope = null;
let _pendingMissionModal = null;

function updateMissionSyncHealth() {
    const stale = telemetryAgeMs(_lastReposEnvelope?._fetched_at) > 26 * 60 * 60 * 1000;
    window.DashboardAlerts?.set('missions', 'sync', stale ? 'Repository sync stale / unavailable (26-hour limit)' : null, 'warning');
}

function renderMissions(data) {
    if (data && data.repos) _lastReposEnvelope = data;
    updateMissionSyncHealth();
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
            // Card body → detail modal (ignore clicks on the GitHub mark / buttons)
            reposGrid.onclick = (e) => {
                if (e.target.closest('[data-stop], [data-mission-action], [data-priority-badge-for], .priority-editor')) return;
                const link = e.target.closest('.repo-card-link');
                if (link) openMissionDetail(link.getAttribute('data-repo'));
            };
            reposGrid.onkeydown = (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                const link = e.target.closest('.repo-card-link');
                if (link) { e.preventDefault(); openMissionDetail(link.getAttribute('data-repo')); }
            };
        }
        if (emptyMsg) emptyMsg.style.display = 'none';
        updateQuestionCount();

        // Deep link "#missions/<repo>" — open its modal once the grid exists.
        const sub = (location.hash.slice(1).split('/')[1] || '');
        const wantRepo = _pendingMissionModal || (sub ? decodeURIComponent(sub) : '');
        _pendingMissionModal = null;
        const overlayOpen = document.getElementById('modal-mission-overlay').style.display !== 'none';
        if (wantRepo && !overlayOpen && _detailRepo !== wantRepo) {
            openMissionDetail(wantRepo);
        } else if (_detailRepo && overlayOpen) {
            renderMissionDetail();  // keep an open modal fresh on re-render
        }

        // Section counts come from the deduplicated renderer; include unclassified
        // cards in the overall total instead of counting raw state entries twice.
        const totalEl = document.getElementById('missions-count');
        if (totalEl) totalEl.textContent = reposGrid?.querySelectorAll('.repo-card-link').length || 0;
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
        // Card body opens the detail modal on click. GitHub opens in a new tab
        // via the small mark button (stops propagation). "?" badge = Aarz has an
        // open question on this repo.
        const q = missionQuestion(repoName);
        const qBadge = q && q.status === 'open'
            ? `<span class="mission-q-badge" title="Aarz has a question">?</span>` : '';
        return `
            <div class="${cardClass}" data-repo="${escapeHtml(repoName)}">
                <div class="repo-card-link" role="button" tabindex="0"
                     draggable="${draggable}" data-drag-kind="${dragKind}" data-repo="${escapeHtml(repoName)}">
                    <div class="repo-card-top">
                        <span class="repo-name" title="${escapeHtml(repo.name)}">${escapeHtml(repo.name)}</span>
                        ${priorityBadgeHtml}
                        ${qBadge}
                        <span class="repo-visibility ${visClass}">${visLabel}</span>
                        <a class="repo-gh" href="${escapeHtml(repo.html_url)}" target="_blank" rel="noopener"
                           title="Open on GitHub" data-stop>${GH_MARK}</a>
                    </div>
                    ${desc}
                    <div class="repo-card-bottom">
                        ${badge}
                        <span class="repo-updated">${updated}</span>
                    </div>
                </div>
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
        const res = await fetch('/agent-dashboard/missions_state.json', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _missionsStateCache = await res.json();
        _missionsStateTs = Date.now();
        window.DashboardAlerts?.set('missions', 'state', null);
        return _missionsStateCache;
    } catch (e) {
        window.DashboardAlerts?.set('missions', 'state', 'Mission state refresh failed; displayed classification may be last known', 'warning');
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

// ─── Mission detail modal ────────────────────────────────────────────────────

let _detailRepo = null;

function updateQuestionCount() {
    const n = Object.keys(_missionDetails).filter(r => {
        const q = missionQuestion(r);
        return q && q.status === 'open';
    }).length;
    const el = document.getElementById('missions-q-count');
    if (el) {
        el.textContent = n ? `Aarz has ${n} question${n > 1 ? 's' : ''}` : '';
        el.style.display = n ? 'inline-flex' : 'none';
    }
}

function openMissionDetail(repo) {
    _detailRepo = repo;
    const overlay = document.getElementById('modal-mission-overlay');
    if (!overlay) return;
    try {
        renderMissionDetail();
    } catch (e) {
        console.error('renderMissionDetail failed', e);
        document.getElementById('modal-mission-summary').textContent = 'Error loading detail: ' + e.message;
    }
    overlay.style.display = 'flex';
    try { history.replaceState(null, '', '#missions/' + encodeURIComponent(repo)); } catch {}
}

function closeMissionDetail() {
    const overlay = document.getElementById('modal-mission-overlay');
    if (overlay) overlay.style.display = 'none';
    _detailRepo = null;
    if (location.hash.startsWith('#missions/')) {
        try { history.replaceState(null, '', '#missions'); } catch {}
    }
}

function _repoInfo(repo) {
    // best-effort repo metadata from the cached repos.json envelope
    const list = (_lastReposEnvelope && _lastReposEnvelope.repos) || [];
    return list.find(r => r.name === repo) ||
        { name: repo, html_url: `https://github.com/Aarz-aaryan/${repo}`, private: false, description: '' };
}

function renderMissionDetail() {
    const repo = _detailRepo;
    if (!repo) return;
    const info = _repoInfo(repo);
    const det = _missionDetails[repo] || {};
    const q = missionQuestion(repo);
    const now = Date.now();

    document.getElementById('modal-mission-title').textContent = repo;
    const meta = document.getElementById('modal-mission-meta');
    const state = _missionsStateCache && _missionsStateCache.missions && _missionsStateCache.missions[repo];
    const bits = [];
    bits.push(info.private ? 'private' : 'public');
    if (state && typeof state.priority === 'number') bits.push('#' + state.priority);
    if (state && state.status) bits.push(state.status);
    else if (_missionsStateCache && (_missionsStateCache.projects || []).includes(repo)) bits.push('project');
    meta.textContent = bits.join('  ·  ');

    // Summary
    document.getElementById('modal-mission-summary').textContent =
        det.summary || 'No summary yet — Aarz will add one on its next run (within 6h).';

    // Activity
    const actEl = document.getElementById('modal-mission-activity');
    const acts = (det.activity || []).slice(0, 6);
    actEl.innerHTML = acts.length
        ? acts.map(a => {
            const t = a.at ? formatAge(now - new Date(a.at).getTime()) : '';
            return `<li><span class="mact-dot ${a.source === 'aarz' ? 'aarz' : ''}"></span>
                    <span class="mact-text">${(a.text || '')}</span>
                    <span class="mact-time">${t || ''}</span></li>`;
        }).join('')
        : '<li class="mact-empty">No recorded activity yet.</li>';

    // Question thread
    const qEl = document.getElementById('modal-mission-question');
    if (q && q.status === 'open') {
        // q.text is server-generated HTML-safe content — insert directly.
        // The user's answer (submitted via JSON, stored server-side) must be escaped
        // when re-rendered here to prevent stored-XSS.
        qEl.innerHTML = `
            <div class="mq-ask"><span class="mq-who">Aarz asks</span>${q.text}</div>
            <textarea id="mq-answer" class="modal-input modal-textarea" rows="3"
                      placeholder="Tell Aarz what this is / what it should do…" maxlength="4000"></textarea>
            <div class="mq-actions">
                <button type="button" class="modal-btn modal-btn-primary" id="mq-send">Send to Aarz</button>
            </div>`;
        qEl.querySelector('#mq-send').addEventListener('click', () => submitMissionAnswer(repo, q.id));
    } else if (q && q.status === 'answered') {
        qEl.innerHTML = `
            <div class="mq-ask"><span class="mq-who">Aarz asked</span>${q.text}</div>
            <div class="mq-answered"><span class="mq-who you">You</span>${escapeHtml(q.answer)}</div>
            <div class="mq-note">Answered ${formatAge(now - new Date(q.answered_at).getTime())} — Aarz will act on this on its next run (within 6h).</div>`;
    } else {
        qEl.innerHTML = `<div class="mq-note">No open question. Aarz will post one here if this project needs direction.</div>`;
    }

    // History
    const histEl = document.getElementById('modal-mission-history');
    const hist = det.question_history || [];
    if (hist.length) {
        histEl.style.display = '';
        histEl.innerHTML = `<summary>Previous Q&amp;A (${hist.length})</summary>` +
            hist.slice().reverse().map(h => `
                <div class="mq-hist">
                    <div class="mq-ask"><span class="mq-who">Aarz</span>${h.text || ''}</div>
                    ${h.answer ? `<div class="mq-answered"><span class="mq-who you">You</span>${escapeHtml(h.answer)}</div>` : ''}
                </div>`).join('');
    } else {
        histEl.style.display = 'none';
        histEl.innerHTML = '';
    }

    document.getElementById('modal-mission-gh').href = info.html_url;
}

async function submitMissionAnswer(repo, questionId) {
    const ta = document.getElementById('mq-answer');
    const btn = document.getElementById('mq-send');
    const answer = (ta && ta.value || '').trim();
    if (!answer) { toast_err('Write an answer first.'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    try {
        const res = await fetch('/api/missions/answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': await getWriteToken() },
            body: JSON.stringify({ repo, question_id: questionId, answer }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) { toast_err(`Couldn't send: ${data.error || res.status}`); return; }
        toast_ok('Sent to Aarz.');
        await loadMissionExtras();
        renderMissionDetail();
        if (_lastReposEnvelope) renderMissions(_lastReposEnvelope);
    } catch (e) {
        toast_err(`Network error: ${e.message}`);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Send to Aarz'; }
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

    document.getElementById('modal-mission-close').addEventListener('click', closeMissionDetail);

    // Close on overlay click (but not on card click)
    document.getElementById('modal-create-overlay').addEventListener('click', (e) => {
        if (e.target.id === 'modal-create-overlay') closeCreateModal();
    });
    document.getElementById('modal-remove-overlay').addEventListener('click', (e) => {
        if (e.target.id === 'modal-remove-overlay') closeRemoveRepoModal();
    });
    document.getElementById('modal-mission-overlay').addEventListener('click', (e) => {
        if (e.target.id === 'modal-mission-overlay') closeMissionDetail();
    });
    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (document.getElementById('modal-create-overlay').style.display !== 'none') closeCreateModal();
            if (document.getElementById('modal-remove-overlay').style.display !== 'none') closeRemoveRepoModal();
            if (document.getElementById('modal-mission-overlay').style.display !== 'none') closeMissionDetail();
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
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderRServerPanel(rData) {
    if (!rData) return;
    const stale = telemetryAgeMs(rData._generated_at) > STALE_DATA_MS;
    const docker = rData.docker_ps;
    const badContainers = (docker?.output || '').split('\n').filter(line => {
        const status = line.split('\t')[1];
        return status && (!/^up\b/i.test(status) || /\bunhealthy\b/i.test(status));
    });
    window.DashboardAlerts?.set('r-server', 'docker', stale ? 'Docker telemetry stale / unavailable' : !docker?.ok ? 'Docker status collection failed' : badContainers.length ? `${badContainers.length} containers stopped / unhealthy` : null, stale || !docker?.ok ? 'warning' : 'error');
    
    if (window.renderRServerStats) window.renderRServerStats(rData);
    
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
                const isRunning = /^up\b/i.test(status) && !/\bunhealthy\b/i.test(status) && !stale;
                const dotClass = isRunning ? 'green' : 'red';
                return `
                    <tr>
                        <td><strong>${escapeHtml(name)}</strong></td>
                        <td>
                            <div class="docker-status-col">
                                <span class="status-dot ${dotClass}"></span>
                                <span>${escapeHtml(status)}${stale ? ' · STALE / last known' : ''}</span>
                            </div>
                        </td>
                        <td style="font-family: 'Share Tech Mono', monospace; font-size: 0.78rem;">${escapeHtml(ports)}</td>
                    </tr>
                `;
            }).join('');
        } else {
            dockerStatusTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--terracotta); font-style:italic;">Connection error or no containers</td></tr>`;
        }
    }
    
}

// ── r-server iframe: load / error / retry + reachability ping ───────────────
// Cross-origin iframe load events also fire for browser error pages. Only the
// bounded network probe establishes reachability (not application health).

const R_SERVER_HOMEPAGE = 'http://100.84.224.18:8383';
let _rServerProbeBusy = false;

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

function onIframeLoad() { probeRServer(); }

// Kept for the inline onerror= hook; real failure detection is probeRServer().
function onIframeError() { probeRServer(); }

function retryIframe() {
    const iframe = document.getElementById('homepage-iframe');
    if (!iframe) return;
    _setRServerPing('checking', 'checking…');
    _showIframeOverlay(false);
    iframe.src = R_SERVER_HOMEPAGE + '/?_r=' + Date.now();
    setTimeout(probeRServer, 1500);
}

async function probeRServer() {
    if (_rServerProbeBusy) return;
    _rServerProbeBusy = true;
    try {
        await fetch(R_SERVER_HOMEPAGE, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(8000) });
        _showIframeOverlay(false);
        _setRServerPing('ok', 'reachable');
        window.DashboardAlerts?.set('r-server', 'homepage', null);
    } catch {
        _showIframeOverlay(true);
        _setRServerPing('down', 'unreachable / browser blocked');
        window.DashboardAlerts?.set('r-server', 'homepage', 'Homepage unreachable or blocked by browser', 'warning');
    } finally {
        _rServerProbeBusy = false;
    }
}



// ── Boot ───────────────────────────────────────────────────────────────────

let isFetching = false;
let _lastHealthData = null;
let _lastRServerData = null;

function refreshTelemetryFreshness() {
    window.renderAgentSchedules?.(latestMissionsJson);
    renderCards(AGENTS.map(a => ({a, d:getAgentData(a.id)})));
    updateStaleBanner();
    updateStatsCounts();
    updateCronStats();
    updateMissionSyncHealth();
    if (_lastHealthData) renderStatsPanel(_lastHealthData);
    if (_lastRServerData) renderRServerPanel(_lastRServerData);
}

async function loadAll() {
    if (isFetching) return;
    isFetching = true;
    const ring = document.getElementById('refreshRing');
    ring?.classList.add('on');
    try {

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
            loadMissionExtras(),
        ]);

    if (missionsJson) latestMissionsJson = missionsJson;
    window.renderAgentSchedules?.(latestMissionsJson);
    // Roster + cards from agents.json
    rebuildRoster();
    renderCards(AGENTS.map(a => ({ a, d: getAgentData(a.id) })));
    AGENTS.forEach(a => setCache(a.id, getAgentData(a.id)));
    updateStatsCounts();
    updateTotalSessionCounts();
    updateStaleBanner();

    window.DashboardAlerts?.set('missions', 'fetch', reposData ? null : 'Repository list refresh failed', 'warning');
    if (healthData) _lastHealthData = healthData;
    if (reposData) renderMissions(reposData);
    if (rServerData) _lastRServerData = rServerData;
    if (_lastHealthData) renderStatsPanel(_lastHealthData);
    if (_lastRServerData) renderRServerPanel(_lastRServerData);
    if (missionsJson) updateCronStats();

    drawTreeLines();
    } catch (error) {
        console.error('Dashboard refresh failed:', error);
    } finally {
        ring?.classList.remove('on');
        isFetching = false;
    }
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
    if (ageMs > STALE_DATA_MS) {
        el.querySelector('span:last-child').textContent = Number.isFinite(ageMs)
            ? `Live data stale — collector last ran ${formatAge(ageMs)}. Check agent-dashboard-collector.service.`
            : 'Live telemetry unavailable or timestamp invalid. Check agent-dashboard-collector.service.';
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
    // Seed the agent row from the static metadata so first paint has nodes;
    // loadAll() -> rebuildRoster() then reconciles against agents.json.
    const seedRow = document.getElementById('agent-row');
    if (seedRow && !seedRow.children.length) {
        seedRow.innerHTML = AGENTS.filter(a => a.id !== 'aarz')
            .map(a => `<div class="tree-node" id="node-${a.id}"></div>`).join('');
    }

    // #hash routing: "#stats" opens a tab; "#missions/<repo>" opens a mission modal
    // once the missions grid has rendered (renderMissions consumes _pendingMissionModal).
    const TABS = ['agents', 'stats', 'missions', 'r-server', 'motorcycle', 'crypto'];
    const applyHash = () => {
        const [tab, sub] = location.hash.slice(1).split('/');
        if (TABS.includes(tab)) switchTab(tab);
        if (tab === 'missions' && sub) {
            const repo = decodeURIComponent(sub);
            if (_lastReposEnvelope) openMissionDetail(repo);
            else _pendingMissionModal = repo;
        }
    };
    const fromHash = location.hash.slice(1).split('/')[0];
    let initial = null;
    if (TABS.includes(fromHash)) initial = fromHash;
    else { try { initial = localStorage.getItem('dash_tab'); } catch {} }
    if (initial && document.getElementById('panel-' + initial)) switchTab(initial);
    applyHash();
    window.addEventListener('hashchange', applyHash);

    loadAll();
    setInterval(loadAll, REFRESH_MS);
    setInterval(refreshTelemetryFreshness, 10000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshTelemetryFreshness();
    });

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

// --- MOTORCYCLE MAINTENANCE CONSOLE ---

let motoIndexData = null;

async function loadMotoIndex() {
    if (motoIndexData) return motoIndexData;
    try {
        // Cache buster isn't strictly necessary but good for development
        const res = await fetch('motorcycle_index.json?_t=' + Date.now());
        if (!res.ok) throw new Error('Network error loading motorcycle index');
        motoIndexData = await res.json();
        window.DashboardAlerts?.set('motorcycle', 'index', null);
        return motoIndexData;
    } catch (e) {
        window.DashboardAlerts?.set('motorcycle', 'index', 'Maintenance index failed to load', 'warning');
        console.error("Failed to load motorcycle index:", e);
        return null;
    }
}


function closeMotoResults() {
    document.getElementById('moto-results-area').style.display = 'none';
}
// Dashboard JS Patch for Moto Results
async function openMotoZone(zone) {
    const data = await loadMotoIndex();
    if (!data) return;
    const matches = data.actions.filter(r => r.zone === zone);
    renderMotoResults(`ZONE: ${zone.toUpperCase()}`, matches);
}

async function executeMotoSearch() {
    const input = document.getElementById('moto-search-input').value.toLowerCase().trim();
    if (!input) return;
    
    const data = await loadMotoIndex();
    if (!data) return;
    
    // Search actions
    const matches = data.actions.filter(r => {
        const inTitle = r.actionTitle.toLowerCase().includes(input);
        const inDesc = r.description.toLowerCase().includes(input);
        const inZone = r.zone.toLowerCase().includes(input);
        const inSources = r.sources.some(s => s.excerpt.toLowerCase().includes(input));
        return inTitle || inDesc || inZone || inSources;
    });
    
    renderMotoResults(`SEARCH: ${input.toUpperCase()}`, matches);
}

function renderMotoResults(title, actions) {
    document.getElementById('moto-results-title').innerText = title;
    const list = document.getElementById('moto-results-list');
    list.innerHTML = '';
    
    if (!actions || actions.length === 0) {
        list.innerHTML = `<div class="moto-empty-state">NO ACTIONS FOUND FOR: ${escapeHtml(title)}</div>`;
    } else {
        actions.forEach((a, idx) => {
            const card = document.createElement('div');
            card.className = 'moto-action-card';
            
            const sourceRefs = a.sources.map(s => `Pg ${s.page}`).join(', ');
            
            const canonicalUrl = 'http://100.84.224.18:9080/index.php/apps/files/?dir=/Motorcycle';
            
            card.innerHTML = `
                <div class="moto-action-header" onclick="toggleMotoDetail(${idx})">
                    <h4 class="moto-card-title">${escapeHtml(a.actionTitle)}</h4>
                    <p class="moto-card-desc">${escapeHtml(a.description)}</p>
                    <div class="moto-card-meta">Sources: ${escapeHtml(sourceRefs)}</div>
                </div>
                <div class="moto-action-detail" id="moto-detail-${idx}" style="display:none;">
                    <div class="moto-detail-content">
                        <h5>MANUAL EXCERPTS</h5>
                        ${a.sources.map(s => `
                            <div class="moto-source-item">
                                <div class="moto-source-meta">
                                    <a href="${canonicalUrl}" target="_blank" style="text-decoration: none; color: #4CAF50; font-weight: bold; margin-bottom: 4px; display: inline-block;">Open Manual ↗</a>
                                    <br>
                                    <span style="font-size: 0.85em; color: #888;">${escapeHtml(s.filename)} - Page ${escapeHtml(String(s.page))}</span>
                                </div>
                                <div class="moto-source-text">"${escapeHtml(s.excerpt).replace(/"/g, '&quot;')}"</div>
                            </div>
                        `).join('')}
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <a href="${canonicalUrl}" target="_blank" class="moto-card-link">OPEN IN NEXTCLOUD FILES</a>
                    </div>
                </div>
            `;
            list.appendChild(card);
        });
    }
    
    document.getElementById('moto-results-area').style.display = 'flex';
}

window.toggleMotoDetail = function(idx) {
    const detail = document.getElementById(`moto-detail-${idx}`);
    if (detail.style.display === 'none') {
        detail.style.display = 'block';
    } else {
        detail.style.display = 'none';
    }
}
