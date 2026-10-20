// Elektročas: large blue departure hall board, Praha hl.n. (elektrocas-4 photo).
// Original drawing inspired by the reference, no photo pixels/assets. Existing OFL fonts substitute the matrix lettering.
const { fields, emptyText } = require('./_station');
const { paginate } = require('./_util');
const BLUE=[12,51,191], BG=[6,8,15], WHITE=[239,243,252], RED=[219,37,47];
const FONT='BarlowCondensed-SemiBold', LABEL='FiraSans-Regular', DELAY=1230;
module.exports={
  id:'praha-hln',name:'Praha hl.n. (Elektročas, velká hala)',style:'lcd',background:BG,unlit:BG,
  colors:{1:WHITE,2:[176,191,223],3:RED,5:WHITE},nativeFont:FONT,
  render(m,t,api){require('./_simple').simpleLed(m,t,api,{title:'Odjezdy'});},
  renderNative(c,t,api){
    const s=Math.min(c.w/1280,c.h/720),w=c.w/s,h=c.h/s;
    const T=(v,x,y,size=28,color=WHITE,maxW=0,align='left',font=FONT)=>c.text(String(v??''),x*s,y*s,{font,size:size*s,color,maxW:maxW*s,align});
    c.clear(BG);c.rect(0,0,c.w,124*s,[9,23,77]);
    c.rect(12*s,10*s,218*s,54*s,[51,57,66]);
    const time=api.hhmm(new Date());
    T(time.slice(0,2),65,54,52,WHITE,82,'center');T(time.slice(-2),174,54,52,WHITE,82,'center');
    if(Math.floor(t/500)%2===0)T(':',120,52,48,WHITE,20,'center');
    T('DEPARTURE',258,48,22,WHITE,160,'left',LABEL);
    T('O D J E Z D',650,52,43,WHITE,460,'center','FiraSans-SemiBold');
    T('ABFAHRT',1040,48,22,WHITE,190,'center',LABEL);
    const labels=[
      [['Zug','Train','Vlak'],25,'left'],[['Nummer','Number','Číslo'],91,'left'],[['Name','Name','Jméno'],187,'left'],
      [['Transp.','Carrier','Dopr.'],310,'left'],[['DESTINATION','ZIELSTATION','CÍLOVÁ STANICE'],395,'left'],
      [['Via','Über','Směr jízdy'],752,'left'],[['Time / Zeit','Pravidelný','odjezd'],1039,'center'],
      [['Bahnsteig','Platform','Nást.'],1135,'center'],[['Verspätung','Delay','Zpoždění min'],DELAY,'center']
    ];
    for(const [lines,x,align]of labels)lines.forEach((v,i)=>T(v,x,82+i*17,i===2?14:11,WHITE,x===395?300:100,align,LABEL));
    const top=137,gap=12,groups=Math.max(1,Math.floor((h-top-12+gap)/(3*30+gap))),per=groups*3;
    const rowH=(h-top-12-(groups-1)*gap)/per,pg=paginate(api.upcoming(),per,t);
    if(!pg.items.length){T(emptyText(api.state),w/2,top+160,48,WHITE,w-40,'center');}
    const fs=Math.min(32,rowH*.83);
    pg.items.forEach((d,i)=>{
      const f=fields(d,api),g=Math.floor(i/3),y0=top+g*(3*rowH+gap)+(i%3)*rowH,y=y0+rowH*.78;
      if(i%3===0)c.rect(0,y0*s,c.w,Math.min(3,pg.items.length-i)*rowH*s,BLUE);
      if(/^(EC|SC)$/.test(f.kind)){
        c.rect(16*s,(y0+2)*s,60*s,(rowH-4)*s,WHITE);
        T(f.kind,48,y,fs,BLUE,49,'center');
      }else T(f.kind,23,y,fs,WHITE,54);
      if(/^(R|Ex|EC|IC|SC|rj|RJ|EN|Sp|AEx)$/.test(f.kind))c.rect(8*s,(y0+2)*s,8*s,(rowH-4)*s,RED);
      T(f.num,91,y,fs,WHITE,85);
      const name=d.trainName||d.name||d.serviceName||(d.line&&d.line!==f.kind?d.line:'');
      T(name,187,y,fs*.87,WHITE,115);
      T(f.op,310,y,fs*.9,WHITE,65);
      T(f.dest.toUpperCase(),395,y,fs,f.cancelled?[255,205,197]:WHITE,344);
      T(f.cancelled?'ZRUŠEN':f.notice||f.dir,752,y,fs*.95,WHITE,226);
      T(f.time,1039,y,fs,WHITE,98,'center');
      T(f.plat||(f.rail?'\uE000':''),1135,y,fs,WHITE,76,'center');
      if(f.delay)T(f.delay,DELAY,y,fs,WHITE,85,'center');
    });
    T(api.statusText(),12,h-2,11,[150,164,190],w-100,'left',LABEL);
    if(pg.pages>1)T(`${pg.page+1}/${pg.pages}`,w-10,h-2,12,WHITE,80,'right',LABEL);
  }
};
