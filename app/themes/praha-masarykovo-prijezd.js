// Elektročas/Pragotron arrivals, Praha Masarykovo (elektrocas-5 photo): seven full-width violet strips, pale matrix lettering.
// Original rendering, not a derivative photo asset. An arrival-look adapter: departure feeds remain departure feeds.
const { fields, emptyText } = require('./_station');
const { paginate } = require('./_util');
const BG=[12,14,23],BAND=[66,66,109],INK=[242,239,179],FONT='BarlowCondensed-Medium';
module.exports={
  id:'praha-masarykovo-prijezd',name:'Praha Masarykovo (Elektročas, příjezd)',style:'lcd',background:BG,unlit:BG,
  colors:{1:INK,2:[184,183,169],3:[255,100,90],5:INK},nativeFont:FONT,
  render(m,t,api){require('./_simple').simpleLed(m,t,{...api,upcoming:()=>api.upcoming().map(d=>({...d,destination:d.origin||fields(d,api).dir||d.destination,plannedTime:d.plannedArrivalTime||d.arrivalTime||d.plannedTime}))},{title:'Příjezdy'});},
  renderNative(c,t,api){
    const s=Math.min(c.w/1280,c.h/720),w=c.w/s,h=c.h/s;
    const T=(v,x,y,size,color=INK,maxW=0,align='left',font=FONT)=>c.text(String(v??''),x*s,y*s,{font,size:size*s,color,maxW:maxW*s,align});
    c.clear(BG);c.rect(0,0,c.w,133*s,[14,22,62]);
    T('ARRIVAL',155,51,26,INK,240,'center','FiraSans-SemiBold');
    T('P Ř Í J E Z D',635,61,54,INK,600,'center','FiraSans-SemiBold');
    T('ANKUNFT',1090,51,26,INK,260,'center','FiraSans-SemiBold');
    T('VÝCHOZÍ STANICE',28,114,35,INK,780,'left','FiraSans-SemiBold');
    T('Pravidelný',1005,96,19,INK,180,'center','FiraSans-SemiBold');T('příjezd',1005,119,19,INK,180,'center','FiraSans-SemiBold');
    T('Zpoždění',1200,96,19,INK,145,'center','FiraSans-SemiBold');T('minut',1200,119,19,INK,145,'center','FiraSans-SemiBold');
    const top=152,gap=16,per=7,rowH=(h-top-13-gap*(per-1))/per,pg=paginate(api.upcoming(),per,t);
    if(!pg.items.length)T(api.state.lastOk?'Žádné příjezdy':emptyText(api.state),w/2,top+160,46,INK,w-40,'center');
    pg.items.forEach((d,i)=>{
      const f=fields(d,api),y0=top+i*(rowH+gap),y=y0+rowH*.79;
      c.rect(12*s,y0*s,c.w-24*s,rowH*s,BAND);
      const origin=d.origin||f.dir||f.dest;
      T(origin,27,y,rowH*.88,f.cancelled?[255,158,143]:INK,835);
      const arrival=d.plannedArrivalTime||d.arrivalTime;
      T(arrival?api.hhmm(new Date(arrival)):f.time,1005,y,rowH*.91,INK,160,'center');
      if(f.cancelled)T('ZRUŠEN',1200,y,rowH*.52,[255,158,143],138,'center');
      else if(f.delay)T(f.delay,1200,y,rowH*.85,INK,135,'center');
    });
    T(api.statusText(),16,h-2,11,[159,163,177],w-100,'left','FiraSans-Regular');
    if(pg.pages>1)T(`${pg.page+1}/${pg.pages}`,w-10,h-2,12,INK,80,'right');
  }
};
