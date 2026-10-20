// Inspired by Stockholm SL blue-black LCD departure displays: clear white lettering and a dedicated departure-time column. Fira Sans is a libre substitute; no official logo.
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

const BG = [8,23,45], INK = [250,252,255], DIM = [160,182,210], RED = [255, 104, 96];
module.exports = {
  id: 'sl', name: 'SL (Stockholm)', style: 'lcd', background: BG, unlit: BG,
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

    c.rect(0,0,W,104*s,[16,55,101]);
    text(c,'SL',x,69*s,48*s,INK,100*s,'left',F.bold);
    text(c,api.stopLabel(api.state.cfg.stop),x+100*s,67*s,34*s,INK,W-400*s,'left',F.bold);
    text(c,api.hhmm(new Date()),right,67*s,36*s,INK,180*s,'right');
    const tx=right-190*s, dest=x+140*s;
    text(c,'LINJE',x,139*s,18*s,DIM,130*s);
    text(c,'DESTINATION',dest,139*s,18*s,DIM,tx-dest-10*s);
    text(c,'AVGÅR',right,139*s,18*s,DIM,180*s,'right');
    c.rect(tx,152*s,W-tx,H-190*s,[12,35,62]);
    const pg=page(c,t,api), top=157*s,row=99*s;
    if (!pg.items.length) return empty(c,api,s,INK,DIM);
    pg.items.forEach((d,i)=>{
      const y=top+i*row;
      text(c,d.line,x,y+49*s,41*s,INK,120*s,'left',F.bold);
      text(c,d.destination || 'cíl neuveden',dest,y+43*s,34*s,d.cancelled?RED:INK,tx-dest-20*s,'left',F.bold);
      const plat=api.platformOf(d);
      text(c,[subline(d,api),api.platLabel(d,'Nást. ')].filter(Boolean).join(' · '),dest,y+76*s,18*s,DIM,tx-dest-20*s);
      text(c,d.cancelled?'Inställd':countdown(api,d,'nu'),right,y+44*s,37*s,d.cancelled?RED:INK,180*s,'right',F.bold);
      if(!d.cancelled) text(c,delay(d,api),right,y+76*s,19*s,RED,180*s,'right');
      c.hline(x,right,y+row-4*s,[38,63,93],1);
    });
    footer(c,api,pg,s,DIM);
  },
};
