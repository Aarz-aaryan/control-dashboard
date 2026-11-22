/* Independent per-host telemetry; SSH is sampled at most every five minutes per viewer. */
(() => {
    'use strict';
    const INTERVAL=300000;
    const container=document.getElementById('crypto-gpu-hosts');
    const states=['mx1','mx2'].map(host=>{
        const root=document.createElement('section');
        root.className='crypto-card crypto-gpu-host';
        const heading=document.createElement('h4'); heading.textContent=host.toUpperCase();
        const rows=document.createElement('div');
        const status=document.createElement('p');
        status.className='mining-source-status'; status.setAttribute('role','status');
        root.append(heading,rows,status); container.append(root);
        return {host,rows,status,result:null,failed:false,busy:false,lastAttempt:null};
    });
    function render(state) {
        const result=state.result, age=result?Date.now()-result.fetched_at*1000:NaN;
        const stale=state.failed || result?.stale || !Number.isFinite(age) || age< -5000 || age>INTERVAL+15000;
        const missing=result?.data.gpus.some(g=>g.temperature_c===null);
        window.DashboardAlerts?.set('crypto','gpu-'+state.host,(result || state.failed) && (stale || missing) ? `${state.host.toUpperCase()} GPU telemetry unavailable / stale` : null,'warning');
        state.status.classList.toggle('crypto-warning',Boolean(stale || missing));
        state.status.textContent=result
            ? `${stale?'Last known / stale readings':'NVIDIA GPU core readings'} · sampled ${new Date(result.fetched_at*1000).toLocaleString()}${state.failed?' · SSH refresh failed (host or authorization unavailable)':''}${missing?' · some sensors unavailable':''}`
            : state.failed?'GPU telemetry unavailable · SSH host or authorization unavailable · retrying every 5 min':'Waiting for GPU readings…';
    }
    async function refresh(state) {
        if(state.busy || state.lastAttempt!==null && Date.now()-state.lastAttempt<INTERVAL)return;
        state.busy=true; state.lastAttempt=Date.now();
        try {
            const response=await fetch('/api/crypto/gpu/'+state.host,{cache:'no-store',signal:AbortSignal.timeout(18000)});
            if(!response.ok)throw new Error('Unavailable');
            const result=await response.json();
            if(!Number.isFinite(result.fetched_at) || result.data?.host!==state.host || !Array.isArray(result.data.gpus) || !result.data.gpus.length ||
               !result.data.gpus.every(g=>Number.isInteger(g.index) && typeof g.name==='string' && (g.temperature_c===null || Number.isFinite(g.temperature_c) && g.temperature_c>=0 && g.temperature_c<=150)))throw new Error('Invalid telemetry');
            state.result=result; state.failed=false;
            const rows=result.data.gpus.map(g=>{
                const row=document.createElement('div'); row.className='crypto-gpu-row';
                const name=document.createElement('span'); name.textContent=`GPU ${g.index} · ${g.name}`;
                const value=document.createElement('strong'); value.textContent=g.temperature_c===null?'—':g.temperature_c+'°C';
                row.append(name,value);return row;
            });
            state.rows.replaceChildren(...rows);
        } catch {state.failed=true;}
        finally {state.busy=false;render(state);}
    }
    function tick() {
        states.forEach(render);
        if(document.hidden)return;
        states.forEach(refresh);
    }
    new MutationObserver(tick).observe(document.getElementById('panel-crypto'),{attributes:true,attributeFilter:['class']});
    document.addEventListener('visibilitychange',tick);
    tick();setInterval(tick,10000);
})();
