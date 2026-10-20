// Inspired by New York MTA subway LCD countdown screens: black, route bullets in official family colours, white arrivals. Fira Sans replaces Helvetica. Other networks get a neutral bullet.
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
// Solid scanline circle: O(radius) square roots instead of per-pixel hypot.
function circle(c,cx,cy,r,color) {
  const h=Math.ceil(2*r);
  for(let j=0;j<h;j++) {
    const dy=j+.5-r, span=Math.sqrt(Math.max(0,r*r-dy*dy));
    if(span>0)c.rect(cx-span,cy-r+j,2*span,1,color);
  }
}
const YELLOW=[252,204,10];
function routeColor(line) {
  if (/^[123]$/.test(line)) return [238,53,46];
  if (/^[456]$/.test(line)) return [0,147,60];
  if (line==='7') return [185,51,173];
  if (/^[ACE]$/.test(line)) return [0,57,166];
  if (/^[BDFM]$/.test(line)) return [255,99,25];
  if (/^[NQRW]$/.test(line)) return YELLOW;
  if (/^[JZ]$/.test(line)) return [153,102,51];
  if (line==='G') return [108,190,69];
  return [91,103,112];
}

const BG = [0,0,0], INK = [255,255,255], DIM = [164,170,174], RED = [255, 104, 96];
module.exports = {
  id: 'mta', name: 'MTA Countdown (New York)', style: 'lcd', background: BG, unlit: BG,
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

    text(c,api.stopLabel(api.state.cfg.stop),x,67*s,42*s,INK,W-245*s,'left',F.bold);
    text(c,api.hhmm(new Date()),right,65*s,34*s,INK,190*s,'right');
    c.hline(x,right,95*s,INK,3*s);
    text(c,'Next arrivals / Příští odjezdy',x,127*s,20*s,DIM,W-100*s);
    const pg=page(c,t,api), top=143*s, row=102*s, dest=x+112*s, end=right-205*s;
    if (!pg.items.length) return empty(c,api,s,INK,DIM);
    pg.items.forEach((d,i)=>{
      const y=top+i*row, label=String(d.line??''), bullet=routeColor(label);
      circle(c,x+37*s,y+48*s,37*s,bullet);
      text(c,label,x+37*s,y+63*s,39*s,bullet===YELLOW?BG:INK,66*s,'center',F.bold);
      text(c,d.destination || 'cíl neuveden',dest,y+46*s,36*s,d.cancelled?RED:INK,end-dest,'left',F.bold);
      const plat=api.platformOf(d);
      text(c,[subline(d,api),api.platLabel(d,'Nást. ')].filter(Boolean).join(' · '),dest,y+78*s,18*s,DIM,end-dest);
      text(c,d.cancelled?'Canceled':countdown(api,d,'Due'),right,y+46*s,39*s,d.cancelled?RED:INK,195*s,'right',F.bold);
      if(!d.cancelled) text(c,delay(d,api),right,y+78*s,20*s,RED,180*s,'right');
      c.hline(dest,right,y+row-4*s,[55,55,55],1);
    });
    footer(c,api,pg,s,DIM);
  },
};
