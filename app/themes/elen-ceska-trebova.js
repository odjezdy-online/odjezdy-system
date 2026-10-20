// Elen Česká Třebová (elen-1 photo): printed white arrivals heading, precise red clock, red express / lime local LED rows.
// Original drawing inspired by the hall board. Origin/arrival timestamps are used when supplied by the feed.
const { makeHall }=require('./_hall');
const { fields }=require('./_station');
const RED=[255,69,90],GREEN=[191,235,24],WHITE=[238,238,233],FONT='BarlowCondensed-Medium';
const color=f=>/^(Os|MOs)$/.test(f.kind)?GREEN:RED;
const theme=makeHall({
 id:'elen-ceska-trebova',name:'Elen Česká Třebová (hala, příjezdy)',simpleTitle:'Příjezdy',
 bg:[4,5,5],band:[24,24,27],ink:GREEN,dim:[202,202,194],font:FONT,labFont:'FiraSans-Regular',
 title:{text:'PŘÍJEZDY',size:48,color:WHITE,font:'FiraSans-Regular',y:61},
 head(c,{T,s,now,api}){
  T('PŘESNÝ ČAS',1196,27,14,WHITE,'FiraSans-Regular',{align:'center'});
  T(api.hhmm(now),1196,66,40,RED,'BarlowCondensed-SemiBold',{align:'center'});
  c.dotScreen(Math.max(2,Math.round(c.w/500)),{bg:[4,5,5],off:[14,8,9],region:{x:1125*s,y:32*s,w:139*s,h:40*s}});
 },
 labels:[
  {t:'DRUH',x:30,y:104,size:13},{t:'VLAKU',x:30,y:121,size:13},
  {t:'ČÍSLO',x:112,y:121,size:13},{t:'VÝCHOZÍ STANICE',x:245,y:121,size:21,color:WHITE},
  {t:'ZE SMĚRU',x:692,y:121,size:21,color:WHITE},
  {t:'PRAVIDELNÝ',x:992,y:103,size:12,align:'center'},{t:'PŘÍJEZD',x:992,y:121,size:12,align:'center'},
  {t:'NÁST.',x:1098,y:121,size:13,align:'center'},{t:'KOLEJ',x:1162,y:121,size:13,align:'center'},
  {t:'ZPOŽDĚNÍ',x:1230,y:103,size:12,align:'center'},{t:'min.',x:1230,y:121,size:12,align:'center'}
 ],top:141,bottom:14,group:1,bandGap:22,minRow:80,maxRow:130,dots:440,off:[11,11,13],noCancelTag:true,
 cols:[
  {key:'kind',size:52,x:30,maxW:72,color},{key:'num',size:48,x:112,maxW:117,color},
  {key:'dest',size:54,x:245,maxW:425,color},{key:'dir',size:48,x:692,maxW:237,color},
  {key:'time',size:52,x:992,maxW:110,align:'center',color},{key:'plat',size:48,x:1098,maxW:55,align:'center',color},
  {key:'track',size:48,x:1162,maxW:50,align:'center',color},{key:'delay',size:52,x:1230,maxW:75,align:'center',color:()=>RED}
 ]
});
const led=theme.render;
theme.render=function(m,t,api){
 led(m,t,{...api,upcoming:()=>api.upcoming().map(d=>({...d,destination:d.origin||fields(d,api).dir||d.destination,
  plannedTime:d.plannedArrivalTime||d.arrivalTime||d.plannedTime}))});
};
const draw=theme.renderNative;
theme.renderNative=function(c,t,api){
 const source=api.upcoming();
 draw(c,t,{...api,upcoming:()=>source.map(d=>({...d,destination:d.origin||fields(d,api).dir||d.destination,
  plannedTime:d.plannedArrivalTime||d.arrivalTime||d.plannedTime}))});
 if(!api.upcoming().length){
  const s=Math.min(c.w/1280,c.h/720),msg=api.state.lastOk?'Žádné příjezdy':api.state.error?'Nelze načíst příjezdy':'Načítám příjezdy…';
  c.rect(0,141*s,c.w,c.h-141*s,[4,5,5]);
  c.text(msg,c.w/2,(141+120)*s,{font:'BarlowCondensed-Medium',size:56*s,color:GREEN,align:'center',maxW:c.w-30*s});
 }
};
module.exports=theme;
