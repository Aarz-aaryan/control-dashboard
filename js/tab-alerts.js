/* Combine independent checks so one healthy source cannot hide another's issue. */
(() => {
    'use strict';
    const tabs=new Map();
    function set(tab, source, message, level='error') {
        if(!tabs.has(tab))tabs.set(tab,new Map());
        const issues=tabs.get(tab);
        if(message)issues.set(source,{message,level});else issues.delete(source);
        const badge=document.getElementById('tab-error-'+tab);
        if(!badge)return;
        const active=[...issues.values()];
        const warning=active.length>0 && active.every(issue=>issue.level==='warning');
        badge.textContent='';
        badge.classList.toggle('visible',active.length>0);
        badge.classList.toggle('tab-warning',warning);
        const label=active.length?`${tab}: ${active.map(issue=>issue.message).join('; ')}`:'';
        badge.title='';
        const item=badge.closest?.('.tab-item');
        const tooltip=item?.querySelector('.tab-label');
        if(tooltip)tooltip.setAttribute('data-alert',active.map(issue=>issue.message).join('\n'));
        if(item) {
            item.setAttribute('aria-label',label || tooltip?.textContent || tab);
            item.setAttribute('tabindex','0');
            item.setAttribute('role','button');
            item.onkeydown=event=>{
                if(event.key==='Enter' || event.key===' ') {event.preventDefault();item.click();}
            };
        }
        badge.setAttribute('role','img');
        badge.setAttribute('aria-label',label);
        badge.setAttribute('aria-hidden',String(active.length===0));
    }
    window.DashboardAlerts={set};
})();
