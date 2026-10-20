// Inspired by Ceefax / ČT Teletext: a 40×25-cell page, eight saturated RGB colours and coarse bitmap glyphs. Fictional page numbering; Czech content stays Czech. Original embedded 5×7 block glyphs, no extra TTF.
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

// Original 5×7 block glyphs in fixed 40-column cells; accents occupy two extra rows.
const BLOCK = {"A":[14,17,17,31,17,17,17],"B":[30,17,17,30,17,17,30],"C":[14,17,16,16,16,17,14],"D":[30,17,17,17,17,17,30],"E":[31,16,16,30,16,16,31],"F":[31,16,16,30,16,16,16],"G":[14,17,16,23,17,17,15],"H":[17,17,17,31,17,17,17],"I":[14,4,4,4,4,4,14],"J":[7,2,2,2,18,18,12],"K":[17,18,20,24,20,18,17],"L":[16,16,16,16,16,16,31],"M":[17,27,21,21,17,17,17],"N":[17,25,21,19,17,17,17],"O":[14,17,17,17,17,17,14],"P":[30,17,17,30,16,16,16],"Q":[14,17,17,17,21,18,13],"R":[30,17,17,30,20,18,17],"S":[15,16,16,14,1,1,30],"T":[31,4,4,4,4,4,4],"U":[17,17,17,17,17,17,14],"V":[17,17,17,17,17,10,4],"W":[17,17,17,21,21,21,10],"X":[17,17,10,4,10,17,17],"Y":[17,17,10,4,4,4,4],"Z":[31,1,2,4,8,16,31],"0":[14,17,19,21,25,17,14],"1":[4,12,4,4,4,4,14],"2":[14,17,1,2,4,8,31],"3":[30,1,1,14,1,1,30],"4":[2,6,10,18,31,2,2],"5":[31,16,16,30,1,1,30],"6":[14,16,16,30,17,17,14],"7":[31,1,2,4,8,8,8],"8":[14,17,17,14,17,17,14],"9":[14,17,17,15,1,1,14],":":[0,4,4,0,4,4,0],".":[0,0,0,0,0,4,4],",":[0,0,0,0,4,4,8],"-":[0,0,0,31,0,0,0],"/":[1,2,2,4,8,8,16],"+":[0,4,4,31,4,4,0],"(":[2,4,8,8,8,4,2],")":[8,4,2,2,2,4,8],"\u00b7":[0,0,0,4,0,0,0],"!":[4,4,4,4,4,0,4]};
// Cache contiguous lit runs, not pixels; same glyphs, fewer draw calls.
const RUNS=new Map();
function glyphRuns(letter) {
  if(RUNS.has(letter))return RUNS.get(letter);
  const normalized=letter.normalize('NFD'),base=BLOCK[normalized[0]];
  if(!base)return null;
  const mark=normalized.slice(1),accent=mark.includes('\u030c')?[10,4]:mark.includes('\u0301')?[2,4]:mark.includes('\u030a')?[4,10]:[0,0];
  const bits=[...accent,...base],runs=[];
  for(let yy=0;yy<bits.length;yy++)for(let xx=0;xx<5;xx++) {
    if(!(bits[yy]&(1<<(4-xx))))continue;
    const start=xx;while(xx+1<5&&(bits[yy]&(1<<(3-xx))))xx++;
    runs.push([start,yy,xx-start+1]);
  }
  // Alphabet cache only: cap it even if a provider sends arbitrary Unicode.
  if(RUNS.size>=256)RUNS.clear();RUNS.set(letter,runs);return runs;
}
const BG = [0,0,0], INK = [255,255,255], DIM = [0,255,255], RED = [255, 104, 96];
module.exports = {
  id: 'teletext', name: 'Teletext P100', style: 'lcd', background: BG, unlit: BG,
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

    const cw=W/40,ch=H/25, blue=[0,0,255],yellow=[255,255,0],green=[0,255,0],red=[255,0,0],magenta=[255,0,255];
    const write=(str,col,row,color,limit=40-col)=>{
      Array.from(String(str??'').toUpperCase()).slice(0,Math.max(0,limit)).forEach((letter,k)=>{
        const runs=glyphRuns(letter); if(!runs)return;
        const ux=cw/6,uy=ch/10,ox=(col+k)*cw,oy=row*ch;
        for(const [xx,yy,width] of runs)c.rect(ox+xx*ux,oy+yy*uy,Math.max(1,width*ux),Math.max(1,uy),color);
      });
    };
    const pg=page(c,t,api,4);
    c.rect(0,0,W,ch,blue);
    write('P'+(100+pg.page)+'  ODJEZDY',0,0,INK,24);
    write(api.hhmm(new Date()),34,0,yellow,6);
    write(api.stopLabel(api.state.cfg.stop),1,2,yellow,38);
    write('LINKA   CIL                     ODJEZD',1,4,DIM,38);
    if(!pg.items.length){ const [a,b]=emptyMessage(api);write(a,1,8,yellow,38);write(b||api.statusText(),1,10,DIM,38);return; }
    pg.items.forEach((d,i)=>{
      const row=6+i*4;
      write(d.line,1,row,green,6);
      write(d.destination||'cíl neuveden',8,row,INK,23);
      write(d.cancelled?'ODPADA':countdown(api,d,'TED'),32,row,d.cancelled?red:yellow,8);
      write(subline(d,api),2,row+1,DIM,38);
      const plat=api.platformOf(d)?'NAST. '+api.platformOf(d):api.platMark(d)?'VLAK':'';
      write([plat,delay(d,api)].filter(Boolean).join('  '),2,row+2,d.cancelled||api.hasDelay(d)?red:green,38);
    });
    c.rect(0,22*ch,W,ch,blue);
    write('ODJEZDY  /  P'+(100+pg.page)+(pg.pages>1?'  '+(pg.page+1)+'/'+pg.pages:''),1,22,INK,38);
    write(api.statusText(),1,24,magenta,38);
  },
};
