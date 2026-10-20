// Inspired by Wiener Linien platform LCD countdown boards: charcoal, oversized white route, right-aligned minutes. Fira Sans substitutes the operator typeface. No official logo.
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

const BG = [17,22,25], INK = [250,251,249], DIM = [159,174,179], RED = [255, 104, 96];
module.exports = {
  id: 'wiener', name: 'Wiener Linien (Vídeň)', style: 'lcd', background: BG, unlit: BG,
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

    c.rect(0,0,W,8*s,[220,32,44]);
    text(c,'ABFAHRTEN',x,45*s,19*s,DIM,W*.5,'left',F.bold);
    text(c,api.stopLabel(api.state.cfg.stop),x,100*s,42*s,INK,W-245*s,'left',F.bold);
    text(c,api.hhmm(new Date()),right,96*s,40*s,INK,180*s,'right',F.bold);
    const pg=page(c,t,api), top=133*s, row=105*s, dest=x+155*s, timeX=right-185*s;
    if (!pg.items.length) return empty(c,api,s,INK,DIM);
    pg.items.forEach((d,i)=>{
      const y=top+i*row;
      c.hline(x,right,y,[67,77,81],1);
      text(c,d.line,x,y+60*s,52*s,INK,135*s,'left',F.bold);
      text(c,d.destination || 'cíl neuveden',dest,y+44*s,35*s,d.cancelled?RED:INK,timeX-dest-22*s,'left',F.bold);
      text(c,subline(d,api),dest,y+77*s,18*s,DIM,timeX-dest-22*s);
      text(c,d.cancelled?'—':countdown(api,d,'jetzt'),right,y+48*s,43*s,INK,180*s,'right',F.bold);
      text(c,delay(d,api),right,y+78*s,19*s,RED,180*s,'right');
      const plat=api.platLabel(d,'Nást. '); if(plat) text(c,plat,x,y+86*s,17*s,DIM,140*s);
    });
    footer(c,api,pg,s,DIM);
  },
};
