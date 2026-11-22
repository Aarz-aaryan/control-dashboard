const assert = require('node:assert/strict');
const {scheduleLabel, renderAgentSchedules} = require('../js/agent-schedules.js');
const el = {innerHTML: ''};
global.document = {getElementById: () => el};
assert.equal(scheduleLabel('35 3 * * *'), 'Daily 03:35');
assert.equal(scheduleLabel('45 3 * * 5,6,0'), 'Fri–Sun 03:45');
assert.equal(scheduleLabel('40 3 * * 0'), 'Sunday 03:40');
assert.equal(scheduleLabel('*/5 * * * *'), 'Every 5 minutes');
assert.equal(scheduleLabel('0 */6 * * *'), 'Every 6 hours');
const now = Date.now();
const data = {_generated_at: new Date(now).toISOString(), cron: [
    {name:'<script>bad</script>', status:'ACTIVE', schedule:'35 3 * * *', next_run:'2026-11-22T03:35:00-05:00', last_status:'error'},
    {name:'Encryption duplicate', status:'PAUSED', schedule:'5 3 * * *', last_status:'error'},
]};
renderAgentSchedules(data, now);
assert.match(el.innerHTML, /1 enabled · 1 paused · 1 with last-run errors/);
assert.match(el.innerHTML, /&lt;script&gt;/);
assert.ok(!el.innerHTML.includes('<script>'));
assert.match(el.innerHTML, /Last run failed/);
assert.match(el.innerHTML, /Paused/);
renderAgentSchedules(data, now + 181000);
assert.match(el.innerHTML, /data is stale/);
renderAgentSchedules(null);
assert.match(el.innerHTML, /unavailable/);
console.log('Agent schedules tests passed');
