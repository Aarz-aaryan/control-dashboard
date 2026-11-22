// node tests/test_mining_value.js
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={window:{}};vm.createContext(context);
vm.runInContext(fs.readFileSync('js/mining-value.js','utf8'),context);
const calculate=context.window.MiningValue.calculate;
const now=1800000000000;
const summary={fetched_at:now/1000,stale:false,data:{revenue:{balance:'0.00164673'}}};
const price={fetched_at:now/1000,stale:false,data:{pair:'BTC/USDT',quote:'USDT',price:'65000'}};
let result=calculate(summary,price,'btc',now);
assert.ok(Math.abs(result.amount-107.03745)<1e-9);assert.equal(result.warning,false);
assert.equal(calculate(summary,null,'btc',now).amount,null);
assert.equal(calculate(summary,price,'aleo',now).amount,null);
assert.equal(calculate(summary,price,'btc',now+181000).warning,true);
assert.equal(calculate(summary,price,'btc',now,false,true).warning,true);
assert.match(calculate(summary,price,'btc',now,true,false).message,/cached balance/);
price.stale=true;assert.match(calculate(summary,price,'btc',now).message,/cached price/);price.stale=false;
summary.data.revenue.balance='0';assert.equal(calculate(summary,price,'btc',now).amount,0);
for(const invalid of [null,'','bad',-1,NaN]) {summary.data.revenue.balance=invalid;assert.equal(calculate(summary,price,'btc',now).amount,null);}
summary.data.revenue.balance='3790.68782386';price.data={pair:'ALEO/USDT',quote:'USDT',price:'0.02915'};
assert.ok(Math.abs(calculate(summary,price,'aleo',now).amount-110.498550065519)<1e-9);
price.data.price=0;assert.equal(calculate(summary,price,'aleo',now).amount,null);
summary.data.revenue.balance='10';price.data={pair:'PEARL/USDT',quote:'USDT',price:'1.95'};
result=calculate(summary,price,'prl',now);
assert.equal(result.amount,19.5);assert.match(result.message,/Gate PEARL\/USDT/);
price.data={pair:'PRL/USDT',quote:'USDT',price:'0.07'};
assert.equal(calculate(summary,price,'prl',now).amount,null);
console.log('Mining USDT valuation tests passed');
