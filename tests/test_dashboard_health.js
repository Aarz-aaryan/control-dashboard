// node tests/test_dashboard_health.js — pure health and failure-path regressions.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const elements={};
const context={console:{error(){}},setInterval(){},setTimeout(){},clearTimeout(){},AbortSignal,
    window:{addEventListener(){},matchMedia(){return {matches:true};}},
    document:{getElementById(id){return elements[id] || null;},querySelectorAll(){return [];},querySelector(){return null;}},
    localStorage:{getItem(){return null;},setItem(){}},Date,fetch:async()=>({ok:false})};
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/dashboard.js','utf8'),context);
const run=code=>vm.runInContext(code,context);
run(`_agentsJson={_generated_at:new Date().toISOString(),agents:{},system:{services:[
    {unit:'aarz-agent.service',state:'active'},{unit:'modelrelay.service',state:'active'}],
    runtime:{discord_connected:true,heartbeat_age_s:5}}};`);
assert.equal(run("getAgentHealth('aarz',{},_agentsJson.system).isHealthy"),true);
run(`latestMissionsJson={_generated_at:new Date().toISOString(),cron:[{status:'ACTIVE',last_status:'error'}]}`);
assert.equal(run("getAgentHealth('pi-scheduler',{},_agentsJson.system).statusLabel"),'JOB FAILURES');
run('latestMissionsJson._generated_at="invalid"');
assert.equal(run("getAgentHealth('pi-scheduler',{},_agentsJson.system).statusLabel"),'SCHEDULE DATA STALE');
assert.equal(run("getAgentHealth('aarz',{},{}).isHealthy"),false);
run('_agentsJson.system.runtime.heartbeat_age_s=null');
assert.equal(run("getAgentHealth('aarz',{},_agentsJson.system).isHealthy"),false);
run('_agentsJson.system.runtime.heartbeat_age_s=5;_agentsJson.system.services[1].state="inactive"');
assert.equal(run("getAgentHealth('aarz',{},_agentsJson.system).isHealthy"),false);
assert.equal(run("telemetryAgeMs('invalid')"),Infinity);
assert.equal(run('telemetryAgeMs(new Date(Date.now()+60000).toISOString())'),Infinity);
run('_agentsJson._generated_at=new Date(Date.now()-200000).toISOString()');
assert.equal(run("getAgentHealth('pi-cli',{},{}).isHealthy"),false);
assert.equal(run("getAgentData('missing').error"),'Integration telemetry unavailable');
assert.equal(run('escapeHtml(42)'),'42');
assert.equal(run("escapeHtml('<img>')"),'&lt;img&gt;');
elements['r-docker-status-tbody']={innerHTML:''};
run(`renderRServerPanel({_generated_at:new Date().toISOString(),docker_ps:{ok:true,output:'<img src=x onerror=alert(1)>\\tUp 1 hour (unhealthy)\\t<port>'}})`);
assert.match(elements['r-docker-status-tbody'].innerHTML,/&lt;img/);
assert.match(elements['r-docker-status-tbody'].innerHTML,/status-dot red/);
run(`renderRServerPanel({_generated_at:new Date(Date.now()-200000).toISOString(),docker_ps:{ok:true,output:'test\\tUp 1 hour\\t80'}})`);
assert.match(elements['r-docker-status-tbody'].innerHTML,/STALE/);
assert.match(elements['r-docker-status-tbody'].innerHTML,/status-dot red/);
(async()=>{
    run('renderCards=()=>{throw new Error("renderer failed")}; loadAgentsJson=async()=>null; fetchJSON=async()=>null;');
    await run('loadAll()');
    assert.equal(run('isFetching'),false,'A failed renderer must not freeze future refreshes');
    let ping='';
    context.setPing=(state,text)=>{ping=state;};
    run('_setRServerPing=setPing;_showIframeOverlay=()=>{}');
    context.fetch=async()=>({});
    await run('probeRServer()');assert.equal(ping,'ok');
    context.fetch=async()=>{throw new Error('network down');};
    await run('probeRServer()');assert.equal(ping,'down','A previously reachable iframe must become unreachable');
    console.log('Dashboard health and refresh failure-path tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
