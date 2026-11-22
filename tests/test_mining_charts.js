// Presentation contract: node tests/test_mining_charts.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = {window:{},echarts:{
    graphic:{LinearGradient:class { constructor(...args) {this.args=args;} }},
    init:() => ({on(){},resize(){},dispatchAction(action){this.action=action;},setOption(option){this.option=option;}}),
}};
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/mining-charts.js','utf8'),context);
const host={clientWidth:1100,setAttribute(key,value){this[key]=value;}};
const title={},legend={};
const state={name:'Bitcoin',view:'hashrate',period:'day',unit:'TH/s',root:{querySelector(selector){
    return selector==='.mining-chart'?host:selector==='.mining-chart-title'?title:legend;
}},result:{data:{hashrate:{key:'BTC (TH/s)',values:[[1000,0],[2000,82.1234]]},rejected:{values:[[1000,0],[2000,0.12]]}}}};
context.window.MiningCharts.draw(state);
let option=state.chart.option;
assert.equal(option.series[0].smooth,true);
assert.equal(option.series[0].lineStyle.color,'#2053e9');
assert.equal(option.yAxis[1].max,100);
assert.equal(option.series[0].data[0][1],0);
assert.equal(option.series[0].data[1][1],82.1234); // No value changes to fit native visuals.
assert.equal(option.series[1].data[1][1],0.12);
assert.equal(option.toolbox.show,false);
context.window.MiningCharts.showTooltip(state,1);
assert.equal(state.index,1);
state.view='distribution';
state.result.data={scale:'M',unit:'proof',hashrate_distribution:[{left_point:200,right_point:300,worker_num:3}]};
context.window.MiningCharts.draw(state);
option=state.chart.option;
assert.equal(option.series[0].type,'bar');
assert.equal(option.series[0].data[0][0],250);
assert.equal(option.series[0].data[0][1],3);
assert.equal(option.brush.brushType,'lineX');
assert.equal(state.distributionUnit,'Mproof/s');
state.view='online';state.period='month';
state.result.data=[{timestamp:123,worker_num:0},{timestamp:456,worker_num:3}];
context.window.MiningCharts.draw(state);
option=state.chart.option;
assert.equal(option.series.length,1);
assert.equal(option.series[0].data[0][0],123000);
assert.equal(option.series[0].data[0][1],0);
assert.match(title.textContent,/30 days/);
host.clientWidth=288;
context.window.MiningCharts.draw(state);
assert.equal(state.chart.option.xAxis.axisLabel.showMinLabel,false);
state.result.data=[];
context.window.MiningCharts.draw(state);
assert.equal(state.chart.option.graphic.style.text,'No F2Pool samples available');
console.log('Mining chart presentation tests passed');
