/* Shared-theme resource renderer. Command success is not a utilization verdict. */
function renderResourceStats(health) {
    const badge = document.getElementById('stats-freshness');
    const generated = health?._generated_at;
    const age = telemetryAgeMs(generated);
    const stale = age > STALE_DATA_MS;
    if (badge) {
        badge.textContent = stale ? 'Telemetry stale / unavailable' : 'Collected ' + new Date(generated).toLocaleTimeString();
        badge.classList.toggle('system-bad', stale);
    }
    const row = (label, value, ok, detail = '') => `<div class="health-item"><div class="health-item-hdr"><span>${escapeHtml(label)}</span><span class="stats-check ${ok && !stale ? '' : 'system-bad'}">${stale ? 'STALE' : ok ? 'AVAILABLE' : 'UNAVAILABLE'}</span></div><div class="health-item-value">${escapeHtml(String(value || 'No data'))}</div>${detail ? `<small class="stats-health-note">${escapeHtml(detail)}</small>` : ''}</div>`;
    const local = health?.local || {};
    const valid = value => Boolean(value && value !== 'Unavailable' && value !== 'Docker not available');
    const target = document.getElementById('local-health-list');
    if (target) {
        const metrics = [['Uptime & load averages','uptime'],['CPU load · 1 / 5 / 15 min','cpu'],['Memory · total / used / free / shared / cache / available','memory'],['Root filesystem','disk'],['Docker containers','docker']];
        target.innerHTML = metrics.map(([label,key]) => row(label, key === 'cpu' && valid(local[key]) ? local[key].trim().split(/\s+/).slice(0,3).join(' / ') : local[key], local.checks?.[key] ?? valid(local[key]))).join('') +
            row('Pi runner · Discord & scheduler', local.pi || 'Unknown', local.pi === 'Running',
                `Discord ${local.pi_runtime?.discord_connected ? 'connected' : 'disconnected'} · heartbeat ${local.pi_runtime?.heartbeat_age_s ?? 'unknown'}s old`);
    }
    const remote = health?.r_server || {};
    const localFailed = ['uptime','cpu','memory','disk','docker'].some(key => !(local.checks?.[key] ?? valid(local[key]))) || local.pi !== 'Running';
    const remoteFailed = ['uptime','docker','memory','disk'].some(key => remote[key]?.ok !== true);
    window.DashboardAlerts?.set('stats', 'resources', stale ? 'Host resource telemetry stale / unavailable' : localFailed || remoteFailed ? 'One or more host resource checks unavailable' : null, 'warning');
    const remoteTarget = document.getElementById('r-server-health-list');
    if (remoteTarget) remoteTarget.innerHTML = [['Uptime & load averages','uptime'],['Docker containers','docker'],['Memory','memory'],['Root filesystem','disk']].map(([label,key])=>row(label,remote[key]?.output,Boolean(remote[key]?.ok))).join('');
}
