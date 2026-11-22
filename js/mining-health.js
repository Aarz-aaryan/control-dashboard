/* Pool-reported mining health, not a direct hardware uptime probe. */
(() => {
    'use strict';
    const FRESH_MS=180000;
    const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function evaluate(result, failed=false, now=Date.now(), expectedCoin=null) {
        if(failed)return {level:'warning',label:'Unavailable',detail:'Fresh F2Pool readings could not be verified; cannot confirm mining status'};
        if(!result)return {level:'warning',label:'Checking',detail:'Waiting for F2Pool readings'};
        const age=now-result.fetched_at*1000;
        if(result.stale || !Number.isFinite(age) || age < -5000 || age > FRESH_MS)
            return {level:'warning',label:'Stale data',detail:'Readings are stale; cannot confirm current mining status'};
        const d=result.data, w=d?.workers;
        if(expectedCoin && d?.coin!==expectedCoin.toUpperCase())
            return {level:'warning',label:'Unknown',detail:'F2Pool currency does not match this mining account'};
        if(!w || !['all','online','offline'].every(k=>Number.isInteger(w[k]) && w[k]>=0) ||
           w.all!==w.online+w.offline || !Number.isFinite(d.hashrate) || d.hashrate<0)
            return {level:'warning',label:'Unknown',detail:'Incomplete or inconsistent F2Pool readings'};
        if(w.online===0 || d.hashrate===0)
            return {level:'down',label:'Not mining',detail:w.online===0?'No online workers reported by F2Pool':'F2Pool reports zero 15-minute hashrate'};
        if(w.offline>0)
            return {level:'warning',label:'Partly offline',detail:`${w.online} of ${w.all} workers online · ${w.offline} offline`};
        return {level:'healthy',label:'Mining',detail:`${w.online}/${w.all} workers online · ${d.hashrate.toLocaleString(undefined,{maximumFractionDigits:2})} ${d.unit}`};
    }
    function render(target,states,now=Date.now()) {
        if(!target)return;
        const readings=states.map(s=>({...s,health:evaluate(s.summaryResult,s.summaryFailed,now,s.coin)}));
        const issues=readings.filter(s=>s.health.level!=='healthy');
        window.DashboardAlerts?.set('crypto','mining',issues.length?issues.map(s=>`${s.coin.toUpperCase()}: ${s.health.label}`).join(' · '):null,issues.some(s=>s.health.level==='down')?'error':'warning');
        const healthy=readings.length>0 && readings.every(s=>s.health.level==='healthy');
        const down=readings.some(s=>s.health.level==='down');
        const checking=readings.every(s=>s.health.label==='Checking');
        const signature=JSON.stringify(readings.map(s=>[s.coin,s.health]));
        if(target.dataset.signature===signature)return;
        target.dataset.signature=signature;
        target.className='master-status-card mining-master-status '+(healthy?'status-all-green':down?'status-has-issues':'status-mining-warning');
        const color=healthy?'':down?'red':'amber';
        const coins=readings.map(s=>s.coin.toUpperCase()).join(' & ');
        const title=healthy?`F2POOL REPORTS ${coins} MINING`:checking?`CHECKING ${coins}`:down?'MINING ATTENTION REQUIRED':'MINING STATUS NEEDS VERIFICATION';
        target.innerHTML=`<div class="master-status-main"><div class="master-status-indicator" aria-hidden="true"><span class="status-pulse-ring ${color}"></span><span class="status-core-dot ${color}"></span></div><div class="master-status-info"><div class="master-status-badge ${healthy?'':down?'badge-red':'badge-amber'}">${healthy?'MINING STATUS: OPERATIONAL':checking?'CONNECTING TO F2POOL':down?'MINING ALERT':'CHECK MINING TELEMETRY'}</div><div class="master-status-title">${title}</div><div class="master-status-sub">${healthy?'All accounts report online workers and positive hashrate.':'Status is based on fresh F2Pool worker and 15-minute hashrate readings.'} Pool-reported activity, not a direct hardware check.</div></div></div><div class="master-status-chips">${readings.map(s=>`<div class="status-chip ${s.health.level==='healthy'?'chip-green':s.health.level==='down'?'chip-red':'chip-amber'}" title="${escape(s.health.detail)}"><span class="chip-dot" aria-hidden="true"></span><span class="chip-label">${escape(s.coin.toUpperCase())}:</span><strong>${escape(s.health.label)}</strong><span class="mining-chip-detail">${escape(s.health.detail)}</span></div>`).join('')}</div>`;
    }
    window.MiningHealth={evaluate,render,FRESH_MS};
})();
