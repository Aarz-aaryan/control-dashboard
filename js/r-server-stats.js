'use strict';
function rBytes(value) {
    if (!Number.isFinite(value) || value < 0) return 'Unavailable';
    const unit = value >= 1024 ** 4 ? 'TiB' : 'GiB';
    return (value / (unit === 'TiB' ? 1024 ** 4 : 1024 ** 3)).toFixed(1) + ' ' + unit;
}
function rUptime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return 'Unavailable';
    const minutes = Math.floor(seconds / 60);
    return `${Math.floor(minutes / 1440)}d ${Math.floor(minutes / 60) % 24}h ${minutes % 60}m`;
}
function rMetrics(data, now = Date.now()) {
    const m = data && data.metrics;
    const time = Date.parse(m && m.data && m.data.observed_at);
    if (!m || !m.ok || !m.data || !Number.isFinite(time) || now - time > 180000 || time - now > 60000) return null;
    return m.data;
}
if (typeof module !== 'undefined') module.exports = {rBytes, rUptime, rMetrics};
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    let latest = null;
    const node = (tag, cls, text) => { const el = document.createElement(tag); el.className = cls; if (text !== undefined) el.textContent = text; return el; };
    function card(title, value, detail, percent) {
        const el = node('section', 'r-metric-card');
        el.append(node('h3', 'r-metric-label', title), node('div', 'r-metric-value', value));
        if (Number.isFinite(percent)) {
            const meter = node('meter', 'r-meter');
            meter.min = 0; meter.max = 100; meter.value = Math.max(0, Math.min(100, percent));
            meter.setAttribute('aria-label', title + ' usage');
            meter.title = percent.toFixed(1) + '%';
            el.append(meter);
        }
        el.append(node('p', 'r-metric-detail', detail));
        return el;
    }
    function render() {
        const target = document.getElementById('r-server-metrics');
        if (!target) return;
        target.replaceChildren();
        const data = rMetrics(latest);
        window.DashboardAlerts?.set('r-server', 'metrics', !data ? 'Server metrics stale / unavailable' : null, 'warning');
        if (!data) {
            target.append(card('Server telemetry', 'Unavailable / stale', 'Readings could not be refreshed. Check the dashboard collector and SSH connectivity.'));
            return;
        }
        const load = Array.isArray(data.load_average) ? data.load_average.map(v => Number(v).toFixed(2)).join(' / ') : 'unavailable';
        target.append(card('System uptime', rUptime(data.uptime_seconds),
            `Load averages (1 / 5 / 15 min): ${load} · ${data.cpu_count || '?'} logical CPUs. Load is not CPU usage.`));
        const mem = data.memory || {};
        const invalidMemory = !Number.isFinite(mem.total) || mem.total <= 0 || !Number.isFinite(mem.available) || mem.available < 0 || mem.available > mem.total;
        const disks = data.disks || [];
        const badDisks = disks.filter(d => !d.mounted || !Number.isFinite(d.total) || d.total <= 0 || !Number.isFinite(d.used) || !Number.isFinite(d.free));
        window.DashboardAlerts?.set('r-server', 'hardware', invalidMemory ? 'RAM reading unavailable' : disks.length !== 3 || badDisks.length ? 'Storage missing, unmounted or unreadable' : null, 'warning');
        if (Number.isFinite(mem.total) && mem.total > 0 && Number.isFinite(mem.available) && mem.available >= 0 && mem.available <= mem.total) {
            const used = mem.total - mem.available;
            const percent = used / mem.total * 100;
            target.append(card('RAM in use', percent.toFixed(1) + '%',
                `${rBytes(used)} of ${rBytes(mem.total)} · ${rBytes(mem.available)} available (including reclaimable cache). ` +
                (mem.swap_total === 0 ? 'No swap configured.' : `Swap: ${rBytes(mem.swap_total - mem.swap_free)} used.`), percent));
        } else target.append(card('RAM in use', 'Unavailable', 'No valid memory reading.'));
        const storage = node('section', 'r-storage');
        storage.append(node('h3', 'r-storage-title', 'Storage — all three drives'));
        const grid = node('div', 'r-storage-grid');
        for (const disk of data.disks || []) {
            if (!disk.mounted) {
                const missing = card(disk.label, 'Not mounted', `${disk.path} · Expected drive unavailable; not showing the SSD underneath.`);
                missing.classList.add('r-metric-warning'); grid.append(missing); continue;
            }
            if (!Number.isFinite(disk.total) || disk.total <= 0 || !Number.isFinite(disk.used) || !Number.isFinite(disk.free)) {
                grid.append(card(disk.label, 'Unavailable', disk.path)); continue;
            }
            const percent = disk.used / disk.total * 100;
            grid.append(card(disk.label, rBytes(disk.free) + ' free',
                `${rBytes(disk.used)} used / ${rBytes(disk.total)} total · ${percent.toFixed(1)}% used · ${disk.path}`, percent));
        }
        storage.append(grid, node('p', 'r-metric-detail', 'Free space excludes filesystem-reserved blocks. Capacities use GiB/TiB, not advertised GB/TB.'));
        target.append(storage, node('p', 'r-metric-updated', 'Updated ' + new Date(data.observed_at).toLocaleTimeString()));
    }
    window.renderRServerStats = data => { latest = data; render(); };
    setInterval(render, 10000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
}
