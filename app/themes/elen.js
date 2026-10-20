// Elen hall board "ODJEZDY" (as simulated in the VISL videos of the Elen LED boards): black panel, white heading, printed column
// titles (Druh, Číslo, CÍLOVÁ STANICE, Směr, Prav. odjezd, Nást., Kolej, Zpoždění), the rows as colour LED dots: Os green,
// R red, fast trains orange. Fills the whole screen. Imitates the look only.
const { makeHall } = require('./_hall');
const GREEN = [70, 226, 70], RED = [255, 66, 48], ORANGE = [255, 160, 24], WHITE = [238, 238, 238];
const kindCol = (f) => (/^(R|Sp|SC|Zr|Rx)$/.test(f.kind) ? RED : /^(Ex|EC|IC|EN|LE|rj|RJ|AEx|Nex|TLX)$/.test(f.kind) ? ORANGE : GREEN);
module.exports = makeHall({
  id: 'elen', name: 'Elen (hala, LED body)', bg: [0, 0, 0], ink: GREEN, dim: [176, 176, 180], font: 'BarlowCondensed-SemiBold', labFont: 'FiraSans-Regular',
  title: { text: 'ODJEZDY', size: 58, color: WHITE, font: 'FiraSans-Regular', y: 74 },
  labels: [
    { t: 'Druh', x: 40, y: 124, size: 14 }, { t: 'Číslo', x: 120, y: 124, size: 14 }, { t: 'CÍLOVÁ STANICE', x: 220, y: 130, size: 19, color: WHITE },
    { t: 'Směr', x: 700, y: 130, size: 19, color: WHITE }, { t: 'Prav. odjezd', x: 1000, y: 124, size: 14 }, { t: 'Nást.', x: 1110, y: 130, size: 14 },
    { t: 'Kolej', x: 1160, y: 130, size: 14, align: 'left' }, { t: 'Zpožd.', x: 1220, y: 130, size: 14, align: 'center' },
  ],
  top: 146, bottom: 14, group: 1, bandGap: 0, minRow: 52, maxRow: 70, dots: 400,
  cols: [
    { key: 'kind', x: 40, color: kindCol }, { key: 'num', x: 120, color: kindCol },
    { key: 'dest', x: 220, maxW: 470, color: kindCol }, { key: 'dir', x: 700, maxW: 290, color: (f) => (f.notice ? ORANGE : kindCol(f)) },
    { key: 'time', x: 1000, color: kindCol }, { key: 'plat', x: 1116, color: kindCol }, { key: 'track', x: 1170, color: kindCol }, { key: 'delay', x: 1220, align: 'center', color: () => ORANGE },
  ],
});
