// Current canonical job roster for the Agents tab. No prompts or scripts rendered.
(function (root) {
    'use strict';
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function scheduleLabel(expr) {
        const [minute, hour, day, month, weekday] = String(expr || '').trim().split(/\s+/);
        if (expr === '*/5 * * * *') return 'Every 5 minutes';
        if (minute === '0' && hour === '*/6' && day === '*' && month === '*' && weekday === '*') return 'Every 6 hours';
        if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && day === '*' && month === '*') {
            const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
            if (weekday === '*') return `Daily ${time}`;
            if (weekday === '0') return `Sunday ${time}`;
            if (weekday === '5,6,0') return `Fri–Sun ${time}`;
        }
        return expr || 'Unknown';
    }
    function nextLabel(value) {
        const date = new Date(value);
        if (!value || !Number.isFinite(date.getTime())) return '—';
        return new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York', weekday:'short',
            hour:'2-digit', minute:'2-digit', hour12:false}).format(date);
    }
    function renderAgentSchedules(data, now = Date.now()) {
        const el = document.getElementById('agent-schedules');
        if (!el) return;
        const at = Date.parse(data?._generated_at);
        const stale = !Number.isFinite(at) || now - at > 180000 || at > now + 5000;
        if (!data || !Array.isArray(data.cron)) {
            el.innerHTML = '<h3>Scheduled jobs</h3><p>Schedule data unavailable. No current-job count can be confirmed.</p>';
            return;
        }
        const jobs = data.cron;
        const enabled = jobs.filter(j => j.status === 'ACTIVE').length;
        const failures = jobs.filter(j => j.status === 'ACTIVE' && (j.last_status === 'error' || j.last_error)).length;
        const rows = jobs.map(job => {
            const active = job.status === 'ACTIVE';
            const failed = active && (job.last_status === 'error' || job.last_error);
            const status = !active ? 'Paused' : failed ? 'Last run failed' : job.last_status === 'ok' ? 'Last run passed' : 'Enabled';
            return `<tr><td>${escape(job.name)}</td><td title="${escape(job.schedule)}">${escape(scheduleLabel(job.schedule))}</td>` +
                `<td>${active ? escape(nextLabel(job.next_run)) : '—'}</td><td class="${failed ? 'schedule-failed' : ''}">${escape(status)}</td></tr>`;
        }).join('');
        el.innerHTML = `<div class="agent-schedules-heading"><h3>Scheduled jobs</h3><span>${enabled} enabled · ${jobs.length - enabled} paused${failures ? ` · ${failures} with last-run errors` : ''}</span></div>` +
            `<p>${stale ? '⚠ Schedule data is stale—last-known roster. ' : ''}Times: America/New_York · Maintenance starts concentrated in 00:00–04:00.</p>` +
            `<div class="agent-schedules-scroll"><table><thead><tr><th>Job</th><th>Schedule (Eastern)</th><th>Next (Eastern)</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>` +
            '<p class="agent-schedules-note">Current app jobs only. Retired Deck and legacy jobs are excluded; their history is preserved. Host backup and OS timers are separate. Career-Ops schedules are unchanged.</p>';
    }
    root.renderAgentSchedules = renderAgentSchedules;
    if (typeof module !== 'undefined') module.exports = {scheduleLabel, nextLabel, renderAgentSchedules};
})(typeof window !== 'undefined' ? window : globalThis);
