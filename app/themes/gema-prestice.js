// Gema, Přeštice (gema-1 photo): dark navy face, three groups of three pale LED rows, red R/Sp and green Os.
// Full hall layout of the train section, not the neighbouring bus board; existing OFL fonts substitute the original face.
const { makeHall } = require('./_hall');
const INK=[204,219,183],WHITE=[242,244,245],FONT='BarlowCondensed-Medium';
const theme=makeHall({
 id:'gema-prestice',name:'Gema Přeštice (velká hala)',bg:[4,14,25],band:[29,45,66],ink:INK,dim:[175,185,193],font:FONT,labFont:'FiraSans-SemiBold',
 title:{text:'ODJEZDY VLAKŮ',size:42,color:WHITE,font:'FiraSans-Bold',y:62},
 head(c,{T,s,now,api}){
  c.rect(1080*s,18*s,182*s,55*s,[28,46,64]);
  T(api.hhmm(now),1171,62,45,[176,199,187],FONT,{align:'center',maxW:170*s});
 },
 labels:[
  {t:'DRUH',x:36,y:117,size:13,color:WHITE},{t:'VLAKU',x:36,y:133,size:13,color:WHITE},
  {t:'ČÍSLO',x:128,y:117,size:13,color:WHITE},{t:'VLAKU',x:128,y:133,size:13,color:WHITE},
  {t:'CÍLOVÁ STANICE',x:293,y:133,size:20,color:WHITE},
  {t:'ODJEZD',x:977,y:133,size:15,color:WHITE,align:'center'},
  {t:'NÁST.',x:1102,y:133,size:15,color:WHITE,align:'center'},
  {t:'ZPOŽDĚNÍ',x:1210,y:115,size:14,color:WHITE,align:'center'},{t:'min',x:1210,y:133,size:14,color:WHITE,align:'center'}
 ],top:151,bottom:14,group:3,bandGap:26,minRow:44,maxRow:100,dots:420,off:[12,23,31],
 cols:[
  {key:'kind',x:43,maxW:74,color:f=>/^(R|Sp|Ex)$/.test(f.kind)?[231,102,105]:[139,202,129]},
  {key:'num',x:132,maxW:132},{key:'dest',x:293,maxW:620,upper:false},
  {key:'time',x:977,maxW:110,align:'center'},{key:'plat',x:1102,maxW:70,align:'center'},
  {key:'delay',x:1210,maxW:90,align:'center'}
 ]
});
module.exports=theme;
