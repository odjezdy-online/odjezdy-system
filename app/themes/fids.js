// Fictional airport FIDS departure board adapted to ground transport: navy, yellow uppercase headings, TIME / SERVICE / DESTINATION / GATE / STATUS. Railway platforms are gates, not invented flight identifiers.
const { simpleLed } = require('./_simple');
const { paginate, emptyMessage, countdown, isRail } = require('./_util');
const F = { regular: 'FiraSans-Regular', bold: 'FiraSans-Bold', condensed: 'BarlowCondensed-SemiBold' };
function subline(d, api) {
  return [api.providerLabel(d), isRail(d) && d.train, d.via?.length && 'přes ' + d.via.join(', '), api.depNotice(d)?.text].filter(Boolean).join(' · ');
}
function delay(d, api) { return d.cancelled ? 'ZRUŠENO' : api.hasDelay(d) ? api.delayLabel(d) : ''; }
function page(c, t, api, per = 5) { return paginate(api.upcoming(), per, t, 8000); }
function text(c, str, x, y, size, color, maxW, align = 'left', font = F.regular) {
  c.text(String(str ?? ''), x, y, { font, size, color, maxW, align });
}
function empty(c, api, s, color, dim) {
  const [a, b] = emptyMessage(api);
  text(c, a, 36*s, 235*s, 34*s, color, c.w-72*s, 'left', F.bold);
  text(c, b || api.statusText(), 36*s, 282*s, 20*s, dim, c.w-72*s);
}
function footer(c, api, pg, s, color) {
  text(c, api.statusText(), 32*s, c.h-17*s, 16*s, color, c.w-155*s);
  if (pg.pages > 1) text(c, `${pg.page+1} / ${pg.pages}`, c.w-32*s, c.h-17*s, 18*s, color, 100*s, 'right');
}

const BG = [7,22,49], INK = [255,218,64], DIM = [156,177,197], RED = [255, 104, 96];
module.exports = {
  id: 'fids', name: 'FIDS (letištní tabule)', style: 'lcd', background: BG, unlit: BG,
  colors: { 1: INK, 2: DIM, 3: RED, 5: INK }, nativeFont: F.bold,
  render(m, t, api) {
    // Keep the standard LED fallback, adding metadata/cancellation without changing shared rows.
    const fallbackApi = { ...api, upcoming: () => api.upcoming().map(d => ({ ...d,
      destination: [d.destination || 'cíl neuveden', d.cancelled && 'ZRUŠENO', api.providerLabel(d),
        d.via?.length && 'přes ' + d.via.join(', ')].filter(Boolean).join(' · ') })) };
    simpleLed(m, t, fallbackApi);
  },
  renderNative(c, t, api) {
    const s = c.h/720, W = c.w, H = c.h, x = 32*s, right = W-32*s;
    c.clear(BG);

    text(c,'ODLETY / ODJEZDY',x,62*s,44*s,INK,W*.65,'left',F.condensed);
    text(c,api.hhmm(new Date()),right,62*s,42*s,INK,190*s,'right',F.condensed);
    text(c,api.stopLabel(api.state.cfg.stop),x,98*s,24*s,[244,247,255],W-100*s);
    c.rect(0,117*s,W,39*s,[24,47,78]);
    const time=x, line=x+105*s, dest=x+240*s, gate=right-340*s, status=right-190*s;
    for(const [label,col] of [['ČAS',time],['SPOJ',line],['CÍL',dest],['NÁSTUPIŠTĚ',gate],['STAV',status]])
      text(c,label,col,143*s,18*s,INK,label==='CÍL'?gate-dest-20*s:label==='NÁSTUPIŠTĚ'?115*s:180*s,'left',F.condensed);
    const pg=page(c,t,api),top=163*s,row=98*s;
    if (!pg.items.length) return empty(c,api,s,INK,DIM);
    pg.items.forEach((d,i)=>{
      const y=top+i*row;
      c.hline(x,right,y+row-3*s,[24,47,78],1);
      text(c,api.hhmm(new Date(d.plannedTime||api.depTime(d))),time,y+42*s,32*s,INK,95*s,'left',F.condensed);
      text(c,d.train||d.line,line,y+42*s,29*s,INK,125*s,'left',F.condensed);
      text(c,(d.destination||'cíl neuveden').toUpperCase(),dest,y+42*s,33*s,d.cancelled?RED:INK,gate-dest-24*s,'left',F.condensed);
      text(c,subline(d,api),dest,y+75*s,17*s,DIM,gate-dest-24*s);
      text(c,api.platMark(d)||'—',gate+40*s,y+42*s,32*s,[244,247,255],95*s,'center',F.condensed);
      const n=api.depNotice(d), late=api.hasDelay(d), msg=d.cancelled?'ZRUŠENO':late?api.delayLabel(d):n?n.text:d.delayMinutes===0?'VČAS':'—';
      text(c,msg,status,y+41*s,26*s,d.cancelled||late?RED:[244,247,255],195*s,'left',F.condensed);
    });
    footer(c,api,pg,s,DIM);
  },
};
