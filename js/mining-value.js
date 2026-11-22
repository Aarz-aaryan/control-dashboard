/* Indicative balance valuation, not a payout amount or executable exchange quote. */
(() => {
    'use strict';
    const decimal=value=>(typeof value==='number' || typeof value==='string' && /^\d+(\.\d+)?$/.test(value)) ? Number(value) : NaN;
    function calculate(summary,price,coin,now=Date.now(),summaryFailed=false,priceFailed=false) {
        if(!summary || !price)return {amount:null,warning:true,message:'Awaiting balance and USDT price…'};
        const balance=decimal(summary.data?.revenue?.balance),rate=decimal(price.data?.price);
        const pair=(coin==='prl'?'PEARL':coin.toUpperCase())+'/USDT';
        if(price.data?.pair!==pair || price.data?.quote!=='USDT' ||
           !Number.isFinite(balance) || balance<0 || !Number.isFinite(rate) || rate<=0 || !Number.isFinite(balance*rate))
            return {amount:null,warning:true,message:'USDT valuation unavailable'};
        const old=result=>!Number.isFinite(result.fetched_at) || now-result.fetched_at*1000>180000 || now-result.fetched_at*1000 < -5000;
        const cachedBalance=summaryFailed || summary.stale || old(summary);
        const cachedPrice=priceFailed || price.stale || old(price);
        return {amount:balance*rate,warning:cachedBalance || cachedPrice,
            message:`Estimate · Gate ${pair} · price fetched ${new Date(price.fetched_at*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}${cachedBalance?' · cached balance':''}${cachedPrice?' · cached price':''}`};
    }
    function render(state,now=Date.now()) {
        const result=calculate(state.summaryResult,state.priceResult,state.coin,now,state.summaryFailed,state.priceFailed);
        const amount=state.root.querySelector('[data-field="balance-usdt"]');
        const detail=state.root.querySelector('[data-field="valuation-status"]');
        amount.textContent=result.amount===null?'—':'≈ '+result.amount.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
        amount.classList.toggle('crypto-warning',result.warning && result.amount!==null);
        detail.textContent=result.amount===null && state.priceFailed?'USDT price unavailable · retrying automatically':result.message;
        detail.classList.toggle('crypto-warning',result.warning);
    }
    window.MiningValue={calculate,render};
})();
