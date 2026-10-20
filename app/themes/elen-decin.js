// Elen Děčín (elen-2 photo), expanded into a full hall board as requested: lime LED text, red underlines and an analogue clock.
// The physical reference is a narrow platform unit; this intentionally retains its visual language across many departures.
const { makeHall }=require('./_hall');
const { pageAt,pageCount }=require('./_util');
const { fields }=require('./_station');
const BG=[6,8,8],GREEN=[180,220,43],RED=[235,48,54],WHITE=[225,230,226];
function clock(c,s,now){
 const cx=1197*s,cy=53*s,r=43*s;
 c.roundRect(cx-r,cy-r,2*r,2*r,r,[27,32,31]);
 for(let i=0;i<12;i++){
  const a=i*Math.PI/6,rr=r*.82;
  c.rect(cx+Math.sin(a)*rr-2*s,cy-Math.cos(a)*rr-2*s,4*s,4*s,WHITE);
 }
 const hand=(a,len,thick)=>{for(let k=0;k<=20;k++){const d=len*k/20;c.rect(cx+Math.sin(a)*d-thick/2,cy-Math.cos(a)*d-thick/2,thick,thick,WHITE);}};
 hand((now.getHours()%12+now.getMinutes()/60)*Math.PI/6,r*.52,4*s);
 hand((now.getMinutes()+now.getSeconds()/60)*Math.PI/30,r*.78,3*s);
 c.rect(cx-3*s,cy-3*s,6*s,6*s,WHITE);
}
const cfg={
 id:'elen-decin',name:'Elen Děčín (halová varianta s hodinami)',bg:BG,ink:GREEN,dim:[190,196,193],font:'BarlowCondensed-Medium',labFont:'FiraSans-Regular',
 title:{text:'ODJEZDY',size:45,color:WHITE,font:'FiraSans-Regular',y:62},
 head(c,{s,now}){clock(c,s,now);},
 labels:[
  {t:'Vlak',x:35,y:123,size:17},{t:'Číslo',x:124,y:123,size:17},{t:'CÍLOVÁ STANICE',x:264,y:123,size:21,color:WHITE},
  {t:'Směr',x:737,y:123,size:20,color:WHITE},{t:'Odjezd',x:1034,y:123,size:17,align:'center'},
  {t:'Nást.',x:1136,y:123,size:17,align:'center'},
  {t:'Zpoždění',x:1230,y:106,size:13,align:'center'},{t:'min.',x:1230,y:124,size:13,align:'center'}
 ],top:145,bottom:14,group:1,bandGap:14,minRow:63,maxRow:110,dots:440,off:[12,17,8],noCancelTag:true,
 cols:[
  {key:'kind',x:35,maxW:72},{key:'num',x:124,maxW:125},{key:'dest',x:264,maxW:451},
  {key:'dir',x:737,maxW:234,upper:false},{key:'time',x:1034,maxW:105,align:'center'},
  {key:'plat',x:1136,maxW:65,align:'center'},{key:'delay',x:1230,maxW:84,align:'center'}
 ]
};
const theme=makeHall(cfg),draw=theme.renderNative;
theme.renderNative=function(c,t,api){
 draw(c,t,api);
 const s=Math.min(c.w/1280,c.h/720),avail=c.h/s-cfg.top-cfg.bottom;
 const per=Math.max(1,Math.floor((avail+cfg.bandGap)/(cfg.minRow+cfg.bandGap))),rh=(avail-(per-1)*cfg.bandGap)/per;
 const deps=api.upcoming(),pages=pageCount(Math.max(1,Math.ceil(Math.min(deps.length,per*4)/per))),pg=pageAt(t,8000,pages);
 deps.slice(pg*per,pg*per+per).forEach((d,i)=>{
  const y=(cfg.top+i*(rh+cfg.bandGap)+rh*.87)*s;
  // Underlines echo the red LED separators of the physical Děčín panel.
  for(const [a,b]of [[35,242],[264,710],[737,964],[985,1084],[1190,1265]])c.hline(a*s,b*s,y,RED,Math.max(1,2*s));
 });
};
module.exports=theme;
