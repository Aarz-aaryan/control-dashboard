'use strict';

function backupView(data, now = Date.now(), fetchFailed = false) {
    const generated = Date.parse(data && data._generated_at);
    if (fetchFailed || !data || !['healthy', 'warning', 'error'].includes(data.status) ||
        !Array.isArray(data.alerts) || !Number.isFinite(generated) ||
        now - generated > 180000 || generated - now > 60000) {
        return {status: 'warning', messages: ['Immich backup monitoring is unavailable or stale. Protection status is unknown.']};
    }
    return {status: data.status, messages: data.alerts.map(a => a.text)};
}

if (typeof module !== 'undefined') module.exports = {backupView};

if (typeof document !== 'undefined') {
    (() => {
        let data = null, failed = false, fetching = false;
        const card = document.getElementById('immich-backup-card');
        const banner = document.getElementById('backup-alert-banner');
        if (!card || !banner) return;
        function render() {
            const view = backupView(data, Date.now(), failed);
            globalThis.window?.DashboardAlerts?.set('r-server', 'backups', view.status === 'healthy' ? null : view.messages.join(' ') || 'Backup protection needs attention', view.status === 'error' ? 'error' : 'warning');
            card.dataset.level = view.status;
            document.getElementById('backup-health-title').textContent =
                view.status === 'healthy' ? 'Immich backups — healthy' : 'Immich backups — attention needed';
            banner.hidden = view.status === 'healthy';
            banner.dataset.level = view.status;
            banner.textContent = view.status === 'healthy' ? '' :
                view.messages.join(' ') + ' See the r-server backup panel.';
            const list = document.getElementById('backup-health-details');
            list.replaceChildren();
            const add = text => { const li = document.createElement('li'); li.textContent = text; list.appendChild(li); };
            view.messages.forEach(add);
            if (data && data.details) {
                const d = data.details;
                const time = value => { const t = Date.parse(value); return Number.isFinite(t) ? new Date(t).toLocaleString() : 'not available'; };
                add('Last saved snapshot: ' + time(d.latest_snapshot && d.latest_snapshot.time));
                add('Last full data check and sample recovery: ' + time(d.verification && d.verification.verified_at));
                if (d.disk && Number.isFinite(d.disk.free)) add('Backup HDD free: ' + (d.disk.free / 1024 ** 3).toFixed(1) + ' GiB');
                const units = d.units || {};
                for (const [unit, label] of [['immich-backup.service', 'Backup'], ['immich-backup-verify.service', 'Verification']]) {
                    const s = units[unit];
                    if (s && ['active', 'activating'].includes(s.ActiveState)) add(label + ' is currently running.');
                }
            }
            add('Nightly incremental backups · Weekly full data checks and sample restores.');
            add('A full database/application restore has not been tested. Alerts are visible here, not push notifications.');
        }
        async function refresh() {
            if (fetching) return;
            fetching = true;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            try {
                const response = await fetch('/agent-dashboard/backup_health.json', {cache: 'no-store', signal: controller.signal});
                if (!response.ok) throw new Error('Status unavailable');
                data = await response.json();
                failed = false;
            } catch (_) { failed = true; }
            finally { clearTimeout(timeout); fetching = false; render(); }
        }
        render();
        refresh();
        setInterval(refresh, 30000);
        setInterval(render, 10000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); refresh(); } });
    })();
}
