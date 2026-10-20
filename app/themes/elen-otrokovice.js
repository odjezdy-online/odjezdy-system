// Elen Otrokovice (elen-4 photo): white arrivals heading, amber clock, olive row bands; red R/Ex, amber EC, lime Os.
// Full hall screen. Photo is a style reference only, no photographic artwork or reference train contents included.
const { makeHall }=require('./_hall');
const { fields }=require('./_station');
const RED=[255,65,71],GREEN=[164,226,27],AMBER=[255,198,78],WHITE=[231,233,223];
const color=f=>/^(Os|MOs)$/.test(f.kind)?GREEN:/^(EC|IC|EN|SC|rj|RJ)$/.test(f.kind)?AMBER:RED;
const theme=makeHall({
 id:'elen-otrokovice',name:'Elen Otrokovice (hala, příjezdy)',simpleTitle:'Příjezdy',bg:[3,5,3],band:[31,39,16],ink:GREEN,dim:[198,201,183],
 font:'BarlowCondensed-Medium',labFont:'FiraSans-Regular',
 title:{text:'Příjezdy',size:43,color:WHITE,font:'FiraSans-Regular',y:58},
 head(c,{T,now,api}){T(api.hhmm(now),1215,61,40,AMBER,'BarlowCondensed-SemiBold',{align:'right'});},
 labels:[
  {t:'Druh',x:35,y:100,size:14},{t:'vlaku',x:35,y:118,size:14},{t:'Číslo',x:114,y:100,size:14},{t:'vlaku',x:114,y:118,size:14},
  {t:'Ze směru',x:245,y:118,size:20,color:WHITE},{t:'Směr jízdy',x:677,y:118,size:18,color:WHITE},
  {t:'Pravidelný',x:994,y:100,size:13,align:'center'},{t:'příjezd',x:994,y:118,size:13,align:'center'},
  {t:'Nást.',x:1111,y:118,size:15,align:'center'},
  {t:'Zpoždění',x:1225,y:100,size:14,align:'center'},{t:'(min.)',x:1225,y:118,size:14,align:'center'}
 ],top:139,bottom:14,group:1,bandGap:22,minRow:78,maxRow:130,dots:440,off:[11,16,7],noCancelTag:true,
 cols:[
  {key:'kind',size:52,x:35,maxW:73,color},{key:'num',size:48,x:114,maxW:114,color},
  {key:'dest',size:54,x:245,maxW:415,color,upper:false},{key:'dir',size:48,x:677,maxW:250,color:()=>GREEN},
  {key:'time',size:52,x:994,maxW:110,align:'center',color},{key:'plat',size:48,x:1111,maxW:92,align:'center',color},
  {key:'delay',size:52,x:1225,maxW:90,align:'center',color}
 ]
});
const led=theme.render;
theme.render=function(m,t,api){
 led(m,t,{...api,upcoming:()=>api.upcoming().map(d=>({...d,destination:d.origin||fields(d,api).dir||d.destination,
  plannedTime:d.plannedArrivalTime||d.arrivalTime||d.plannedTime}))});
};
const draw=theme.renderNative;
theme.renderNative=function(c,t,api){
 draw(c,t,{...api,upcoming:()=>api.upcoming().map(d=>{const f=fields(d,api);return {...d,
  destination:d.origin||f.dir||f.dest,plannedTime:d.plannedArrivalTime||d.arrivalTime||d.plannedTime,
  platform:f.track&&f.plat?`${f.plat} / ${f.track}`:d.platform};}),
  platformOf:d=>{const p=String(d.platform||'');return /^\w+ \/ \w+$/.test(p)?p:api.platformOf(d);}});
 if(!api.upcoming().length){
  const s=Math.min(c.w/1280,c.h/720),msg=api.state.lastOk?'Žádné příjezdy':api.state.error?'Nelze načíst příjezdy':'Načítám příjezdy…';
  c.rect(0,139*s,c.w,c.h-139*s,[3,5,3]);
  c.text(msg,c.w/2,(139+120)*s,{font:'BarlowCondensed-Medium',size:56*s,color:GREEN,align:'center',maxW:c.w-30*s});
 }
};
module.exports=theme;
