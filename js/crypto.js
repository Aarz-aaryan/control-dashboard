(() => {
    'use strict';
    const el = id => document.getElementById('crypto-' + id);
    const text = (id, value) => { el(id).textContent = value; };
    const num = value => Number.isFinite(value) ? value.toLocaleString(undefined, {maximumFractionDigits:2}) : '—';
    const date = value => Number.isFinite(value) ? new Date(value).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : 'unknown time';
    const accounts = [
        {coin:'btc', name:'Bitcoin', unit:'TH/s'},
        {coin:'aleo', name:'Aleo', unit:'Mproof/s'},
        {coin:'prl', name:'Pearl', unit:'TH/s'},
    ];
    const states = [];
    let piResult=null, piFailed=false;
    const staleCopy=(result,maxAge=180000)=>result?.stale || !Number.isFinite(result?.fetched_at) || Date.now()-result.fetched_at*1000>maxAge || Date.now()-result.fetched_at*1000 < -5000;
    async function get(source) {
        const response = await fetch('/api/crypto/' + source, {signal:AbortSignal.timeout(22000), cache:'no-store'});
        if (!response.ok) throw new Error('Source unavailable');
        return response.json();
    }
    for (const account of accounts) {
        const root = document.createElement('section');
        root.className = 'crypto-card mining-panel';
        root.id = 'mining-' + account.coin;
        root.innerHTML = `
            <div class="mining-header"><div><div class="crypto-eyebrow">${account.coin.toUpperCase()} · F2POOL</div><h3>${account.name} Mining</h3><small data-field="account">Awaiting configured account</small></div><a class="crypto-pill" target="_blank" rel="noopener noreferrer">Open F2Pool ↗</a></div>
            <div class="mining-live"><div><label>15-MIN HASHRATE</label><strong data-field="hashrate">—</strong></div><div><label>24-HOUR AVERAGE</label><strong data-field="average">—</strong></div><div><label>WORKERS · ONLINE / ALL</label><strong data-field="workers">—</strong><small data-field="worker-detail"></small></div></div>
            <div class="mining-revenue">${[['total','TOTAL INCOME'],['paid','TOTAL PAYOUT'],['balance','BALANCE']].map(([key,label]) => `<div><label>${label}</label><strong data-revenue="${key}">—</strong><small>${account.coin.toUpperCase()}</small></div>`).join('')}<div class="mining-usdt-balance"><label>BALANCE IN USDT</label><strong data-field="balance-usdt">—</strong><small>USDT · APPROXIMATE</small></div></div>
            <p class="mining-source-status" data-field="valuation-status" role="status">Awaiting balance and USDT price…</p>
            <p class="mining-source-status" data-field="summary-status" role="status">Connecting to F2Pool…</p>
            <div class="mining-controls"><div class="crypto-ranges mining-views" role="group" aria-label="${account.name} chart"><button data-view="hashrate" class="selected" aria-pressed="true">Hashrate</button><button data-view="distribution" aria-pressed="false">Worker Hashrate Distribution</button>${account.coin === 'btc' ? '<button data-view="online" aria-pressed="false">Online Worker Chart</button>' : ''}</div></div>
            <div class="mining-plot-shell"><div class="mining-plot-heading"><h4 class="mining-chart-title">Hashrate of last 24 hours</h4><div class="crypto-ranges mining-periods" role="group" aria-label="${account.name} period"><button data-period="day" class="selected" aria-pressed="true" title="Last 24 hours · 30-minute samples">30min</button><button data-period="month" aria-pressed="false" title="Last 30 days · daily samples">1d</button></div></div>
            <div class="mining-chart-wrap"><div class="mining-chart" role="img" tabindex="0" aria-label="${account.name} mining hashrate history"></div></div><div class="mining-legend"></div></div>
            <p class="mining-source-status" data-field="chart-status" role="status">Loading mining history…</p>`;
        root.querySelector('a').hidden = true;
        document.getElementById('mining-panels').append(root);
        const state = {...account, root, view:'hashrate', period:'day', request:0, result:null, points:[], index:0};
        states.push(state);
        root.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
            state.view = button.dataset.view;
            root.querySelectorAll('[data-view]').forEach(b => {b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button));});
            updatePeriodLabels(state); changeChart(state);
        }));
        root.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
            state.period = button.dataset.period;
            root.querySelectorAll('[data-period]').forEach(b => {b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button));});
            changeChart(state);
        }));
        const host = root.querySelector('.mining-chart');
        host.addEventListener('focus', () => showTooltip(state, state.points.length-1));
        host.addEventListener('blur', () => {
            state.chart?.dispatchAction({type:'hideTip'});
            state.chart?.dispatchAction({type:'downplay'});
        });
        host.addEventListener('keydown', event => {
            if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key) || !state.points.length) return;
            event.preventDefault();
            const index = event.key === 'Home' ? 0 : event.key === 'End' ? state.points.length-1 : state.index + (event.key === 'ArrowLeft' ? -1 : 1);
            showTooltip(state, Math.max(0, Math.min(state.points.length-1, index)));
        });
        new ResizeObserver(() => {if (state.result) draw(state);}).observe(host.parentElement);
    }
    function updateStatuses() {
        window.MiningHealth.render(document.getElementById('crypto-master-status'), states);
        states.forEach(state => {
            window.MiningValue.render(state);
            updateSummaryStatus(state);
            updateChartStatus(state);
            const value=window.MiningValue.calculate(state.summaryResult,state.priceResult,state.coin,Date.now(),state.summaryFailed,state.priceFailed);
            window.DashboardAlerts?.set('crypto','price-'+state.coin,state.priceFailed || state.priceResult && value.warning ? `${state.coin.toUpperCase()} USDT valuation unavailable / stale` : null,'warning');
            window.DashboardAlerts?.set('crypto','chart-'+state.coin,state.chartFailed || state.result && document.getElementById('panel-crypto').classList.contains('active') && staleCopy(state.result) ? `${state.coin.toUpperCase()} graph unavailable / stale` : null,'warning');
        });
        updatePiStatus();
    }
    updateStatuses();
    // Expire stale copies even while this tab is not fetching new readings.
    setInterval(updateStatuses, 10000);
    document.addEventListener('visibilitychange', updateStatuses);
    function field(state, key, value) {state.root.querySelector(`[data-field="${key}"]`).textContent=value;}
    function status(state, key, message, warning=false) {
        const target=state.root.querySelector(`[data-field="${key}-status"]`);
        if(target.textContent!==message) target.textContent=message;
        target.classList.toggle('crypto-warning',Boolean(warning));
    }
    function updateSummaryStatus(state) {
        if(state.summaryFailed) {status(state,'summary','F2Pool refresh failed · displayed readings are last known, not confirmed current',true);return;}
        if(!state.summaryResult)return;
        const result=state.summaryResult, stale=staleCopy(result);
        status(state,'summary',`${stale?'Cached / stale copy · last fetched':'F2Pool readings · fetched'} ${date(result.fetched_at*1000)}`,stale);
    }
    function updateChartStatus(state) {
        const result=state.result;
        if(state.chartFailed) {status(state,'chart','Graph refresh failed · retrying automatically'+(result?' · displayed graph is last known':''),true);return;}
        if(!result)return;
        const stale=staleCopy(result);
        const values=state.view==='hashrate'?result.data.hashrate.values:state.view==='online'?result.data:null;
        const latest=values?.length?(state.view==='online'?values.at(-1).timestamp*1000:values.at(-1)[0]):null;
        status(state,'chart',`${stale?'Cached / stale graph':'F2Pool source data'} · fetched ${date(result.fetched_at*1000)}${latest?' · latest source sample '+date(latest):values?' · No source samples':''}`,stale);
    }
    function updatePiStatus() {
        const stale=piFailed || piResult && staleCopy(piResult,60000);
        if(!piResult && !piFailed)return;
        const d=piResult?.data;
        const valid=d && ['temperature','humidity','fan1_speed','fan2_speed'].every(key=>Number.isFinite(d[key]));
        window.DashboardAlerts?.set('crypto','climate',stale || !valid ? 'Pi climate / fan readings unavailable or stale' : null,'warning');
        text('pi-status',piFailed?'Pi fetch failed':stale?'Cached / stale Pi copy':valid?'Pi API reachable · read-only':'Pi readings incomplete');
        el('pi-status').classList.toggle('crypto-warning',Boolean(stale || !valid));
        text('sensor-time',piResult?`Source sensor clock: ${d?.last_updated || 'unavailable'} · Pi local time (no date supplied) · API fetched ${date(piResult.fetched_at*1000)}${stale?' · readings are last known':''}`:'Telemetry unavailable');
    }
    function updatePeriodLabels(state) {
        const distribution = state.view === 'distribution';
        const day=state.root.querySelector('[data-period="day"]'), month=state.root.querySelector('[data-period="month"]');
        day.textContent=distribution?'Real Time':state.view==='online'?'24h':'30min';
        month.textContent=distribution?'1d':state.view==='online'?'30d':'1d';
        day.title=distribution?'15-minute worker hashrates':'Last 24 hours';
        month.title=distribution?'24-hour worker hashrates':'Last 30 days · daily samples';
    }
    async function summary(state) {
        try {
            const result=await get(`mining/${state.coin}/summary`), d=result.data;
            if(d?.coin!==state.coin.toUpperCase() || typeof d.account!=='string' || !d.account ||
                (state.account && d.account!==state.account) || d.unit!==state.unit)
                throw new Error('Mining account/currency mismatch');
            const source=new URL(d.source_url);
            if(source.protocol!=='https:' || source.hostname!=='www.f2pool.com' || source.port || source.username || source.password)
                throw new Error('Unexpected mining source URL');
            state.account=d.account;
            field(state,'account',d.account);
            const link=state.root.querySelector('a');
            link.href=source.href; link.hidden=false;
            state.summaryResult=result; state.summaryFailed=false;
            field(state,'hashrate',num(d.hashrate)+' '+d.unit); field(state,'average',num(d.hashrate_24h)+' '+d.unit);
            field(state,'workers',`${d.workers.online} / ${d.workers.all}`);
            field(state,'worker-detail',`${d.workers.offline} offline · ${d.workers.dead} dead · ${d.rejected_percent}% rejected (24h)`);
            Object.entries(d.revenue).forEach(([key,value]) => {
                const target=state.root.querySelector(`[data-revenue="${key}"]`);
                if(target) target.textContent=value;
            });
        } catch {state.summaryFailed=true;}
        finally {updateStatuses();}
    }
    async function price(state) {
        try {
            state.priceResult=await get(`price/${state.coin}`);
            state.priceFailed=false;
        } catch {state.priceFailed=true;}
        finally {updateStatuses();}
    }
    function changeChart(state) {
        state.result=null;state.points=[];state.chartFailed=false;
        state.chart?.clear();
        state.root.querySelector('.mining-legend').textContent='';
        chart(state);
    }
    async function chart(state) {
        const request=++state.request;
        const view = state.view === 'hashrate' ? state.period : state.view === 'distribution' ? (state.period === 'day' ? 'distribution' : 'distribution-day') : 'online-'+state.period;
        status(state,'chart','Updating F2Pool graph…');
        const previousResult=state.result,previousPoints=state.points;
        try {
            const result=await get(`mining/${state.coin}/${view}`);
            if (request !== state.request) return;
            state.result=result;draw(state);state.chartFailed=false;
            updateChartStatus(state);
        } catch {
            if (request !== state.request) return;
            state.result=previousResult;state.points=previousPoints;state.chartFailed=true;
            if(previousResult) {try {draw(state);} catch {state.chart?.clear();}}
            else state.chart?.clear();
            updateChartStatus(state);
        }
    }
    function draw(state) { window.MiningCharts.draw(state); }
    function showTooltip(state, index) { window.MiningCharts.showTooltip(state, index); }
    async function telemetry() {
        try {
            const result = await get('pi'), d = result.data;
            const value = (v, unit) => Number.isFinite(v) ? v + unit : '—';
            text('temp', value(d.temperature,'°C')); text('humidity',value(d.humidity,'%'));
            for (const n of [1,2]) {
                const speed = d['fan'+n+'_speed'];
                text('fan'+n,value(speed,'%'));
                el('fan'+n+'-bar').style.width = (Number.isFinite(speed)?Math.max(0,Math.min(100,speed)):0)+'%';
            }
            text('mode',d.mode || 'Waiting for sensor');
            piResult=result;piFailed=false;
        } catch {piFailed=true;}
        finally {updatePiStatus();}
    }
    let busy=false;
    async function refresh() {
        if(busy || document.hidden)return;
        busy=true;
        const visible=document.getElementById('panel-crypto').classList.contains('active');
        try {await Promise.allSettled([telemetry(),...states.flatMap(s=>[summary(s),price(s),...(visible?[chart(s)]:[])])]);}finally{busy=false;}
    }
    new MutationObserver(refresh).observe(document.getElementById('panel-crypto'),{attributes:true,attributeFilter:['class']});
    document.addEventListener('visibilitychange',refresh);
    refresh();setInterval(refresh,30000);
})();
