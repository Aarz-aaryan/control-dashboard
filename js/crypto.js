(() => {
    'use strict';
    const el = id => document.getElementById('crypto-' + id);
    const text = (id, value) => { el(id).textContent = value; };
    const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const num = value => Number.isFinite(value) ? value.toLocaleString(undefined, {maximumFractionDigits:2}) : '—';
    const date = value => new Date(value).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    const accounts = [
        {coin:'btc', name:'Bitcoin', account:'avalonm21qfv', unit:'TH/s'},
        {coin:'aleo', name:'Aleo', account:'aleo89cn', unit:'Mproof/s'},
    ];
    const states = [];
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
            <div class="mining-header"><div><div class="crypto-eyebrow">${account.coin.toUpperCase()} · F2POOL</div><h3>${account.name} Mining</h3><small>${account.account}</small></div><a class="crypto-pill" target="_blank" rel="noopener noreferrer">Open F2Pool ↗</a></div>
            <div class="mining-live"><div><label>15-MIN HASHRATE</label><strong data-field="hashrate">—</strong></div><div><label>24-HOUR AVERAGE</label><strong data-field="average">—</strong></div><div><label>WORKERS · ONLINE / ALL</label><strong data-field="workers">—</strong><small data-field="worker-detail"></small></div></div>
            <div class="mining-revenue">${[['total','TOTAL INCOME'],['yesterday','YESTERDAY'],['paid','TOTAL PAYOUT'],['estimated_today','TODAY · ESTIMATE'],['balance','BALANCE']].map(([key,label]) => `<div><label>${label}</label><strong data-revenue="${key}">—</strong><small>${account.coin.toUpperCase()}</small></div>`).join('')}</div>
            <p class="mining-source-status" data-field="summary-status" role="status">Connecting to F2Pool…</p>
            <div class="mining-controls"><div class="crypto-ranges mining-views" role="group" aria-label="${account.name} chart"><button data-view="hashrate" class="selected" aria-pressed="true">Hashrate</button><button data-view="distribution" aria-pressed="false">Worker distribution</button>${account.coin === 'btc' ? '<button data-view="online" aria-pressed="false">Online workers</button>' : ''}</div><div class="crypto-ranges mining-periods" role="group" aria-label="${account.name} period"><button data-period="day" class="selected" aria-pressed="true">24H · 30min</button><button data-period="month" aria-pressed="false">30D · Daily</button></div></div>
            <div class="mining-chart-wrap"><svg class="mining-chart" role="img" tabindex="0" aria-label="${account.name} mining hashrate history"></svg><div class="mining-tooltip" hidden></div></div>
            <div class="mining-legend"></div><p class="mining-source-status" data-field="chart-status" role="status">Loading mining history…</p>`;
        root.querySelector('a').href = `https://www.f2pool.com/mining-user${account.coin === 'aleo' ? '-aleo' : ''}/8b74118c9d1c4eddd42b91e7e45a7257?user_name=${account.account}`;
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
        const svg = root.querySelector('svg');
        svg.addEventListener('pointermove', event => {
            if (!state.points.length) return;
            const rect = svg.getBoundingClientRect(), target = (event.clientX-rect.left)/rect.width*state.width;
            let index = 0;
            state.points.forEach((point, i) => {if (Math.abs(state.x(point[0])-target) < Math.abs(state.x(state.points[index][0])-target)) index=i;});
            showTooltip(state, index);
        });
        svg.addEventListener('pointerleave', () => {root.querySelector('.mining-tooltip').hidden=true;});
        svg.addEventListener('focus', () => showTooltip(state, state.points.length-1));
        svg.addEventListener('blur', () => {root.querySelector('.mining-tooltip').hidden=true;});
        svg.addEventListener('keydown', event => {
            if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key) || !state.points.length) return;
            event.preventDefault();
            const index = event.key === 'Home' ? 0 : event.key === 'End' ? state.points.length-1 : state.index + (event.key === 'ArrowLeft' ? -1 : 1);
            showTooltip(state, Math.max(0, Math.min(state.points.length-1, index)));
        });
        new ResizeObserver(() => {if (state.result) draw(state);}).observe(svg.parentElement);
    }
    function field(state, key, value) {state.root.querySelector(`[data-field="${key}"]`).textContent=value;}
    function status(state, key, message, warning=false) {
        const target=state.root.querySelector(`[data-field="${key}-status"]`);
        target.textContent=message; target.classList.toggle('crypto-warning',warning);
    }
    function updatePeriodLabels(state) {
        const distribution = state.view === 'distribution';
        state.root.querySelector('[data-period="day"]').textContent = distribution ? '15-min hashrate' : '24H · ' + (state.view === 'online' ? 'Hourly' : '30min');
        state.root.querySelector('[data-period="month"]').textContent = distribution ? '24h hashrate' : '30D · Daily';
    }
    async function summary(state) {
        try {
            const result=await get(`mining/${state.coin}/summary`), d=result.data;
            field(state,'hashrate',num(d.hashrate)+' '+d.unit); field(state,'average',num(d.hashrate_24h)+' '+d.unit);
            field(state,'workers',`${d.workers.online} / ${d.workers.all}`);
            field(state,'worker-detail',`${d.workers.offline} offline · ${d.workers.dead} dead · ${d.rejected_percent}% rejected (24h)`);
            Object.entries(d.revenue).forEach(([key,value]) => {state.root.querySelector(`[data-revenue="${key}"]`).textContent=value;});
            status(state,'summary',`${result.stale ? 'Cached · F2Pool unreachable · last fetched' : 'F2Pool readings · fetched'} ${date(result.fetched_at*1000)}`,result.stale);
        } catch {status(state,'summary','F2Pool readings unavailable · any displayed values are last known',true);}
    }
    function changeChart(state) {
        state.result=null;state.points=[];
        state.root.querySelector('svg').innerHTML='';state.root.querySelector('.mining-tooltip').hidden=true;
        state.root.querySelector('.mining-legend').textContent='';
        chart(state);
    }
    async function chart(state) {
        const request=++state.request;
        const view = state.view === 'hashrate' ? state.period : state.view === 'distribution' ? (state.period === 'day' ? 'distribution' : 'distribution-day') : 'online-'+state.period;
        status(state,'chart','Updating F2Pool graph…');
        try {
            const result=await get(`mining/${state.coin}/${view}`);
            if (request !== state.request) return;
            state.result=result;draw(state);
            const latest = state.view === 'distribution' ? '' : ` · latest sample ${date(state.points.at(-1)?.[0])}`;
            status(state,'chart',`${result.stale ? 'Cached graph · F2Pool unreachable' : 'F2Pool source data'} · fetched ${date(result.fetched_at*1000)}${state.points.length ? latest : ' · No samples'}`,result.stale);
        } catch {
            if (request !== state.request) return;
            status(state,'chart','Graph unavailable · retrying automatically'+(state.result?' · displayed graph is last known':''),true);
        }
    }
    function draw(state) {
        const svg=state.root.querySelector('svg'), d=state.result.data;
        const width=Math.max(260,Math.round(svg.parentElement.clientWidth)), height=260;
        state.width=width;
        svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
        let points, rejected=[], unit, bars=state.view==='distribution';
        if (bars) {
            points=d.hashrate_distribution.map(bin=>[(bin.left_point+bin.right_point)/2,bin.worker_num,bin.left_point,bin.right_point]);
            unit='workers';
        } else if (state.view==='online') {
            points=d.map(p=>[p.timestamp*1000,p.worker_num]);unit='workers';
        } else {
            points=d.hashrate.values.map(p=>[p[0],p[1]]);
            rejected=d.rejected?.values || [];
            unit=d.hashrate.key.match(/\(([^)]+)\)/)?.[1] || state.unit;
        }
        points=points.filter(p=>Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a,b)=>a[0]-b[0]);
        state.points=points;state.chartUnit=unit;
        svg.setAttribute('aria-label',`${state.name} ${state.view}, ${bars ? (state.period==='day'?'15-minute':'24-hour')+' worker distribution' : state.period==='day'?'24 hours':'30 days'}, ${points.length} samples, ${unit}. Use left and right arrow keys to inspect.`);
        if (!points.length) {svg.innerHTML=`<text x="16" y="130" fill="currentColor">No F2Pool samples available</text>`;return;}
        const left=45,right=width-(rejected.length?38:14),top=26,bottom=222;
        const minX=bars ? d.hashrate_distribution[0].left_point : points[0][0];
        const maxX=bars ? d.hashrate_distribution.at(-1).right_point : points.at(-1)[0];
        const maxY=Math.max(1,...points.map(p=>p[1]))*1.12;
        const x=v=>left+(v-minX)/(maxX-minX || 1)*(right-left), y=v=>bottom-v/maxY*(bottom-top);
        state.x=x;
        let html=`<text x="${left}" y="14" fill="currentColor" font-size="11">${escape(unit)}</text>`;
        for(let i=0;i<4;i++) {
            const value=maxY*i/3, yy=y(value);
            html+=`<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" stroke="currentColor" opacity=".1"/><text x="${left-7}" y="${yy+4}" text-anchor="end" fill="currentColor" font-size="10">${escape(num(value))}</text>`;
        }
        if (bars) {
            html+=points.map(p=>`<rect x="${x(p[2])+1}" y="${y(p[1])}" width="${Math.max(1,x(p[3])-x(p[2])-2)}" height="${bottom-y(p[1])}" rx="2" fill="var(--sage)" opacity=".85"/>`).join('');
        } else {
            const path=points.map((p,i)=>`${i?'L':'M'}${x(p[0])},${y(p[1])}`).join(' ');
            html+=`<path d="${path} L${x(points.at(-1)[0])},${bottom} L${x(points[0][0])},${bottom} Z" fill="var(--gold)" opacity=".08"/><path d="${path}" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linejoin="round"/>`;
            const validReject=rejected.filter(p=>Number.isFinite(p[0]) && Number.isFinite(p[1]));
            if(validReject.length) {
                const maxReject=Math.max(1,...validReject.map(p=>p[1]))*1.1;
                html+=`<path d="${validReject.map((p,i)=>`${i?'L':'M'}${x(p[0])},${bottom-p[1]/maxReject*(bottom-top)}`).join(' ')}" fill="none" stroke="var(--terracotta)" stroke-width="1.5" stroke-dasharray="4 3"/>`;
                html+=`<text x="${right+5}" y="14" fill="var(--terracotta)" font-size="10">rej.%</text>`;
                for(let i=0;i<3;i++) html+=`<text x="${right+5}" y="${bottom-i/2*(bottom-top)+4}" fill="var(--terracotta)" font-size="10">${num(maxReject*i/2)}</text>`;
            }
        }
        const tickCount=width<500?2:4;
        for(let i=0;i<tickCount;i++) {
            const value=minX+(maxX-minX)*i/(tickCount-1);
            const label=bars ? num(value)+' '+d.scale+d.unit+'/s' : new Date(value).toLocaleString([], {month:'short',day:'numeric',...(state.period==='day'?{hour:'2-digit',minute:'2-digit'}:{})});
            html+=`<text x="${x(value)}" y="246" text-anchor="${i===0?'start':i===tickCount-1?'end':'middle'}" fill="currentColor" font-size="10">${escape(label)}</text>`;
        }
        svg.innerHTML=html;
        state.root.querySelector('.mining-legend').innerHTML = bars ? 'Worker count by hashrate bucket' : `<span>● ${state.view==='online'?'Online workers':'Hashrate'}</span>${rejected.length?'<span class="mining-rejected">┄ Rejected % · right axis</span>':''}`;
    }
    function showTooltip(state, index) {
        const p=state.points[index];if(!p)return;
        state.index=index;
        const tooltip=state.root.querySelector('.mining-tooltip');tooltip.hidden=false;
        if(state.view==='distribution') {
            const d=state.result.data;
            tooltip.textContent=`${num(p[2])}–${num(p[3])} ${d.scale}${d.unit}/s · ${num(p[1])} workers`;
        } else {
            const rejected=state.view==='hashrate' ? state.result.data.rejected?.values.find(r=>r[0]===p[0])?.[1] : null;
            tooltip.textContent=`${date(p[0])} · ${num(p[1])} ${state.chartUnit}${Number.isFinite(rejected)?' · rejected '+num(rejected)+'%':''}`;
        }
    }
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
            text('sensor-time',`Sensor update: ${d.last_updated || 'not yet available'} · Pi local time · fetched ${date(result.fetched_at*1000)}`);
            text('pi-status',result.stale?'Cached · Pi unreachable':'Connected · read-only');
            el('pi-status').classList.toggle('crypto-warning',result.stale);
        } catch { text('pi-status','Pi unreachable'); el('pi-status').classList.add('crypto-warning'); text('sensor-time','Telemetry unavailable · displayed values, if any, are last known'); }
    }
    let busy=false;
    async function refresh() {
        if(busy || !document.getElementById('panel-crypto').classList.contains('active') || document.hidden)return;
        busy=true;
        try {await Promise.allSettled([telemetry(),...states.flatMap(s=>[summary(s),chart(s)])]);}finally{busy=false;}
    }
    new MutationObserver(refresh).observe(document.getElementById('panel-crypto'),{attributes:true,attributeFilter:['class']});
    document.addEventListener('visibilitychange',refresh);
    refresh();setInterval(refresh,30000);
})();
