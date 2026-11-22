'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {rBytes, rUptime, rMetrics} = require('../js/r-server-stats.js');
assert.equal(rBytes(1024 ** 3), '1.0 GiB');
assert.equal(rBytes(2 * 1024 ** 4), '2.0 TiB');
assert.equal(rBytes(-1), 'Unavailable');
assert.equal(rUptime(86400 + 3660), '1d 1h 1m');
assert.equal(rUptime(-1), 'Unavailable');
const now = Date.now();
const data = {metrics: {ok: true, data: {observed_at: new Date(now).toISOString(), uptime_seconds: 100,
    cpu_count: 4, load_average: [.1, .2, .3], memory: {total: 100, available: 40, swap_total: 0},
    disks: [{mounted: true, label: 'SSD', path: '/', total: 100, used: 30, free: 60},
            {mounted: false, label: 'HDD', path: '/mnt/disk2'}]}}};
assert(rMetrics(data, now));
assert.equal(rMetrics(data, now + 181000), null);
assert.equal(rMetrics({metrics: {ok: false}}, now), null);
assert.equal(rMetrics(null, now), null);
function element() { return {children: [], classList: {add() {}},
    append(...els) { this.children.push(...els); }, replaceChildren() { this.children = []; }, setAttribute() {}}; }
const target = element();
const context = {window: {}, document: {hidden: false, createElement: element,
    getElementById: () => target, addEventListener() {}}, setInterval() {}, Date, Number};
vm.runInNewContext(fs.readFileSync(require.resolve('../js/r-server-stats.js'), 'utf8'), context);
context.window.renderRServerStats(data);
const flatten = el => [el.textContent || '', ...el.children.map(flatten)].join(' ');
assert.match(flatten(target), /60.0%/);
assert.match(flatten(target), /Not mounted/);
assert.match(flatten(target), /No swap configured/);
context.window.renderRServerStats(null);
assert.match(flatten(target), /Unavailable \/ stale/);
assert(!flatten(target).includes('60.0%'));
console.log('r-server formatting, mount safety, rendering and stale-state checks passed');
