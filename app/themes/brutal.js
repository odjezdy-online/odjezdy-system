// Original fictional editorial departure board: warm paper, oversized condensed route numbers, heavy black rules and a single vermilion accent. Uses existing OFL Barlow Condensed and Fira Sans.
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

const BG = [238,235,224], INK = [20,21,19], DIM = [94,94,86], RED = [255, 104, 96];
module.exports = {
  id: 'brutal', name: 'Brutal (fiktivní)', style: 'lcd', background: BG, unlit: BG,
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

    text(c,'DALŠÍ.',x,86*s,79*s,INK,330*s,'left',F.condensed);
    text(c,api.stopLabel(api.state.cfg.stop),x+270*s,65*s,30*s,INK,W-550*s,'left',F.bold);
    text(c,api.hhmm(new Date()),right,76*s,50*s,INK,210*s,'right',F.condensed);
    c.hline(x,right,110*s,INK,7*s);
    const pg=page(c,t,api,4),top=133*s,row=132*s,dest=x+165*s,end=right-215*s,accent=[184,35,15];
    if (!pg.items.length) return empty(c,api,s,INK,DIM);
    pg.items.forEach((d,i)=>{
      const y=top+i*row;
      text(c,d.line,x,y+83*s,79*s,INK,145*s,'left',F.condensed);
      text(c,d.destination||'cíl neuveden',dest,y+53*s,40*s,INK,end-dest,'left',F.condensed);
      const plat=api.platformOf(d);
      text(c,[subline(d,api),api.platLabel(d,'Nást. ')].filter(Boolean).join(' · '),dest,y+91*s,18*s,DIM,end-dest);
      text(c,d.cancelled?'ODPADÁ':countdown(api,d,'TEĎ'),right,y+57*s,45*s,d.cancelled?accent:INK,200*s,'right',F.condensed);
      if(!d.cancelled)text(c,delay(d,api),right,y+94*s,21*s,accent,200*s,'right',F.bold);
      c.hline(x,right,y+row-8*s,INK,2*s);
    });
    footer(c,api,pg,s,DIM);
  },
};
