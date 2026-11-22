'use strict';
const assert = require('assert');
const {backupView} = require('../js/backup-health.js');
const now = Date.now();
const healthy = {_generated_at: new Date(now).toISOString(), status: 'healthy', alerts: []};
assert.equal(backupView(healthy, now).status, 'healthy');
assert.equal(backupView(healthy, now, true).status, 'warning');
assert.equal(backupView(healthy, now + 181000).status, 'warning');
assert.equal(backupView(null, now).status, 'warning');
assert.equal(backupView({...healthy, status: 'nonsense'}, now).status, 'warning');
assert.equal(backupView({...healthy, alerts: null}, now).status, 'warning');
assert.equal(backupView({...healthy, _generated_at: 'bad'}, now).status, 'warning');
assert.equal(backupView({...healthy, _generated_at: new Date(now + 120000).toISOString()}, now).status, 'warning');
assert.equal(backupView({...healthy, status: 'error', alerts: [{text: 'Backup failed'}]}, now).status, 'error');
// Exercise actual DOM rendering and fetch failure without touching live status.
const vm = require('vm');
const fs = require('fs');
const source = fs.readFileSync(require.resolve('../js/backup-health.js'), 'utf8');
async function renderFixture(payload, rejectFetch = false) {
    const ids = ['immich-backup-card', 'backup-alert-banner', 'backup-health-title', 'backup-health-details'];
    const elements = Object.fromEntries(ids.map(id => [id, {dataset: {}, hidden: false, textContent: '', children: [],
        replaceChildren() { this.children = []; }, appendChild(el) { this.children.push(el); }}]));
    const document = {hidden: false, getElementById: id => elements[id],
        createElement: () => ({textContent: ''}), addEventListener() {}};
    const context = {document, Date, Number, AbortController, setTimeout, clearTimeout,
        setInterval() {}, fetch: async () => {
            if (rejectFetch) throw Error('offline');
            return {ok: true, json: async () => payload};
        }};
    vm.runInNewContext(source, context);
    await new Promise(resolve => setImmediate(resolve));
    return elements;
}
(async () => {
    let dom = await renderFixture({...healthy, details: {}});
    assert.equal(dom['backup-alert-banner'].hidden, true);
    assert.equal(dom['immich-backup-card'].dataset.level, 'healthy');
    dom = await renderFixture({...healthy, status: 'error', alerts: [{text: 'Backup failed'}], details: {}});
    assert.equal(dom['backup-alert-banner'].hidden, false);
    assert.match(dom['backup-alert-banner'].textContent, /Backup failed/);
    assert.equal(dom['immich-backup-card'].dataset.level, 'error');
    dom = await renderFixture(healthy, true);
    assert.equal(dom['backup-alert-banner'].hidden, false);
    assert.equal(dom['immich-backup-card'].dataset.level, 'warning');
    console.log('Backup health freshness and DOM-rendering checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
