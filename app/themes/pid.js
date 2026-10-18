// Inspired by new Prague PID stop LCD displays: navy ground, white destinations, mode-coloured route badges and minutes. Fira Sans substitutes the PID typeface. No official branding assets.
const { simpleLed } = require('./_simple');
const { paginate, emptyMessage, countdown, isRail } = require('./_util');
const F = { regular: 'FiraSans-Regular', bold: 'FiraSans-Bold', condensed: 'BarlowCondensed-SemiBold' };
function subline(d, api) {
  return [d.provider, isRail(d) && d.train, d.via?.length && 'přes ' + d.via.join(', '), api.depNotice(d)?.text].filter(Boolean).join(' · ');
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
const METRO_B=[255,206,0];
function modeColor(d) {
  if (d.type==='metro' || d.type==='subway') return ({A:[0,151,80],B:METRO_B,C:[224,33,40]})[d.line] || [224,33,40];
  if (isRail(d)) return [0,122,189];
  if (d.type==='tram') return [166,15,44];
  if (d.type==='ferry') return [0,140,157];
  if (d.type==='trolleybus') return [135,79,154];
  return [0,118,83];
}

const BG = [13,31,53], INK = [255,255,255], DIM = [170,190,208], RED = [255, 104, 96];
module.exports = {
  id: 'pid', name: 'PID (Praha)', style: 'lcd', background: BG, unlit: BG,
  colors: { 1: INK, 2: DIM, 3: RED, 5: INK }, nativeFont: F.bold,
  render(m, t, api) {
    // Keep the standard LED fallback, adding metadata/cancellation without changing shared rows.
    const fallbackApi = { ...api, upcoming: () => api.upcoming().map(d => ({ ...d,
      destination: [d.destination || 'cíl neuveden', d.cancelled && 'ZRUŠENO', d.provider,
        d.via?.length && 'přes ' + d.via.join(', ')].filter(Boolean).join(' · ') })) };
    simpleLed(m, t, fallbackApi);
  },
  renderNative(c, t, api) {
    const s = c.h/720, W = c.w, H = c.h, x = 32*s, right = W-32*s;
    c.clear(BG);

    c.rect(0,0,12*s,H,[222,25,44]);
    text(c,api.stopLabel(api.state.cfg.stop),x,76*s,43*s,INK,W-280*s,'left',F.bold);
    text(c,api.hhmm(new Date()),right,73*s,38*s,INK,190*s,'right',F.bold);
    c.hline(x,right,105*s,[91,115,138],2*s);
    text(c,'LINKA',x,137*s,18*s,DIM,130*s);
    text(c,'SMĚR',x+145*s,137*s,18*s,DIM,W*.5);
    text(c,'ZA MIN',right,137*s,18*s,DIM,170*s,'right');
    const pg=page(c,t,api), top=151*s,row=100*s,dest=x+145*s,end=right-185*s;
    if (!pg.items.length) return empty(c,api,s,INK,DIM);
    pg.items.forEach((d,i)=>{
      const y=top+i*row, fill=modeColor(d);
      c.roundRect(x,y+17*s,116*s,52*s,3*s,fill);
      text(c,d.line,x+58*s,y+55*s,35*s,fill===METRO_B?BG:INK,100*s,'center',F.bold);
      text(c,d.destination || 'cíl neuveden',dest,y+44*s,34*s,d.cancelled?RED:INK,end-dest-12*s,'left',F.bold);
      const plat=api.platformOf(d);
      text(c,[subline(d,api),plat && 'Nást. '+plat].filter(Boolean).join(' · '),dest,y+78*s,18*s,DIM,end-dest-12*s);
      const mins=api.minutesTo(d), when=mins<60?String(Math.max(0,mins)):api.hhmm(new Date(api.depTime(d)));
      text(c,d.cancelled?'ODPADÁ':when,right,y+47*s,d.cancelled?28*s:46*s,d.cancelled?RED:INK,175*s,'right',F.bold);
      if(!d.cancelled) text(c,delay(d,api),right,y+78*s,19*s,RED,175*s,'right');
      c.hline(x,right,y+row-3*s,[48,70,91],1);
    });
    footer(c,api,pg,s,DIM);
  },
};
