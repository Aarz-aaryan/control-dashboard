/* F2Pool-inspired presentation using the same Apache ECharts chart engine.
 * Source readings stay unchanged; smoothing is visual interpolation only.
 */
(() => {
    'use strict';
    const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const format = value => Number(value).toLocaleString(undefined, {maximumFractionDigits:2});
    const date = (value, daily=false) => new Date(value).toLocaleString([], {
        month:'short', day:'numeric', ...(!daily ? {hour:'2-digit',minute:'2-digit',hour12:false} : {}),
    });
    const gradient = (top, bottom) => new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:top},{offset:1,color:bottom}]);
    const blue = '#2053e9', red = '#df8787', ink = '#8d9ea7', grid = '#e7edf3';
    const finite = p => Number.isFinite(p[0]) && Number.isFinite(p[1]);
    function draw(state) {
        const host=state.root.querySelector('.mining-chart');
        if (!host.clientWidth) return;
        if (!state.chart) {
            state.chart=echarts.init(host, null, {renderer:'canvas'});
            state.chart.on('brushSelected', event => {
                if(state.view!=='distribution') return;
                const indexes=event.batch?.[0]?.selected?.[0]?.dataIndex || [];
                const legend=state.root.querySelector('.mining-legend');
                if(!indexes.length) {legend.textContent='Drag across the plot to inspect workers in a hashrate range.';return;}
                const selected=indexes.map(i=>state.points[i]).filter(Boolean);
                if(!selected.length)return;
                legend.textContent=`${format(Math.min(...selected.map(p=>p[2])))}–${format(Math.max(...selected.map(p=>p[3])))} ${state.distributionUnit} · ${selected.reduce((n,p)=>n+p[1],0)} workers`;
            });
        }
        state.chart.resize();
        const data=state.result.data, bars=state.view==='distribution', online=state.view==='online';
        const daily=state.period==='month', mobile=host.clientWidth<600;
        let points, rejected=[], unit;
        if(bars) {
            points=data.hashrate_distribution.map(b=>[(b.left_point+b.right_point)/2,b.worker_num,b.left_point,b.right_point]);
            unit='workers';state.distributionUnit=data.scale+data.unit+'/s';
        } else if(online) {
            points=data.map(p=>[p.timestamp*1000,p.worker_num]);unit='workers';
        } else {
            points=data.hashrate.values.map(p=>[p[0],p[1]]);
            rejected=(data.rejected?.values || []).filter(finite);
            unit=data.hashrate.key.match(/\(([^)]+)\)/)?.[1] || state.unit;
        }
        points=points.filter(finite).sort((a,b)=>a[0]-b[0]);
        state.points=points;state.chartUnit=unit;
        const hasRejected=rejected.some(p=>p[1]>0);
        const title=bars?'Worker Number':online?`Online workers of last ${daily?'30 days':'24 hours'}`:`Hashrate of last ${daily?'30 days':'24 hours'}`;
        state.root.querySelector('.mining-chart-title').textContent=title;
        host.setAttribute('aria-label',`${state.name}: ${title}, ${points.length} samples. Use left and right arrows to inspect exact readings.`);
        const axisLine={show:true,lineStyle:{color:grid,width:1}};
        const label={color:ink,fontSize:mobile?10:12};
        const yAxis={type:'value',min:0,name:bars||online?'':`Hashrate (${unit})`,nameLocation:'end',nameGap:16,
            nameTextStyle:{color:ink,fontSize:12,align:'left'},axisLabel:label,axisLine,axisTick:{show:false},
            splitNumber:8,splitLine:{show:true,lineStyle:{color:grid}},...(bars||online?{minInterval:1}:{})};
        const option={
            animationDuration:350,animationDurationUpdate:250,textStyle:{fontFamily:'Arial, sans-serif'},
            aria:{enabled:true},toolbox:{show:false},
            grid:{left:mobile?5:10,right:hasRejected?12:mobile?16:24,top:46,bottom:mobile?48:26,containLabel:true},
            tooltip:{trigger:'axis',confine:true,backgroundColor:'rgba(0,59,181,.85)',borderWidth:0,padding:[12,15],
                textStyle:{color:'#fff',fontSize:12,lineHeight:22},extraCssText:'border-radius:10px;',
                axisPointer:{type:bars?'shadow':'line',lineStyle:{color:'#2149c8',width:1}},
                formatter:params=>{
                    if(!params.length)return '';
                    if(bars) {
                        const point=points[params[0].dataIndex];
                        return `Hashrate: <strong>${format(point[2])} ~ ${format(point[3])} ${escape(state.distributionUnit)}</strong><br>Worker Number: <strong>${point[1]}</strong>`;
                    }
                    return `<div style="margin-bottom:4px">${escape(date(params[0].value[0],daily))}</div>`+params.map(p=>`${p.marker}${escape(p.seriesName)}: <strong>${format(p.value[1])}${p.seriesName==='Rejected'?'%':online?'':' '+escape(unit)}</strong>`).join('<br>');
                }},
            xAxis:{type:bars?'value':'time',min:points.length?(bars?points[0][2]:points[0][0]):undefined,
                max:bars&&points.length?points.at(-1)[3]:undefined,
                splitNumber:mobile?3:6,axisLabel:{...label,hideOverlap:true,showMinLabel:!mobile,showMaxLabel:!mobile,rotate:!bars&&mobile?35:0,
                    formatter:value=>bars?format(value):date(value,daily)},
                axisLine,axisTick:{show:false},splitLine:{show:true,lineStyle:{color:grid}},
                name:bars?state.distributionUnit:'',nameLocation:'end',nameGap:6,
                nameTextStyle:{color:ink,fontSize:11,align:'right',padding:[30,0,0,0]}},
            yAxis:[yAxis,...(hasRejected?[{...yAxis,name:'Rejected (%)',min:0,max:100,splitNumber:5,
                nameTextStyle:{color:ink,fontSize:12,align:'right'},splitLine:{show:false}}]:[])],
            series:bars?[{name:'Workers',type:'bar',data:points.map(p=>p.slice(0,2)),barMaxWidth:38,
                itemStyle:{color:gradient('#1054e6','#59dbe6')},encode:{x:0,y:1},
                emphasis:{itemStyle:{color:'#2889fc'}}}]:[
                {name:online?'Online workers':'Total',type:'line',data:points.map(p=>p.slice(0,2)),
                    smooth:true,showSymbol:false,symbol:'circle',symbolSize:6,
                    lineStyle:{color:blue,width:2},itemStyle:{color:blue,borderColor:blue},
                    areaStyle:{color:gradient('rgba(44,120,249,.30)','rgba(45,123,250,.03)')}},
                ...(hasRejected?[{name:'Rejected',type:'line',data:rejected.map(p=>p.slice(0,2)),
                    smooth:true,showSymbol:false,yAxisIndex:1,lineStyle:{color:red,width:2},itemStyle:{color:red}}]:[]),
            ],
            ...(bars?{brush:{xAxisIndex:0,brushType:'lineX',brushMode:'single',throttleType:'debounce',throttleDelay:150,
                brushStyle:{color:'rgba(40,137,252,.15)',borderColor:'rgba(40,137,252,.5)',borderWidth:1},
                outOfBrush:{colorAlpha:.35}}}:{}),
            ...(!points.length?{graphic:{type:'text',left:'center',top:'middle',style:{text:'No F2Pool samples available',fill:ink,fontSize:14}}}:{}),
        };
        state.chart.setOption(option,{notMerge:true});
        if(bars)state.chart.dispatchAction({type:'takeGlobalCursor',key:'brush',brushOption:{brushType:'lineX',brushMode:'single'}});
        state.root.querySelector('.mining-legend').textContent=bars?'Drag across the plot to inspect workers in a hashrate range.':hasRejected?'Blue: total hashrate · Red: rejected shares (right axis, 0–100%)':online?'Online worker count':'Total hashrate';
    }
    function showTooltip(state,index) {
        if(!state.points[index] || !state.chart)return;
        state.index=index;
        state.chart.dispatchAction({type:'downplay'});
        state.chart.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:index});
        state.chart.dispatchAction({type:'highlight',seriesIndex:0,dataIndex:index});
    }
    window.MiningCharts={draw,showTooltip};
})();
