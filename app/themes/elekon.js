// Elekon hall board (ODJEZDY): black frame, wide grey heading, "CÍLOVÁ STANICE", blue bands of three rows with a red tick,
// kind of train, operator, number, destination in white, time, platform and delay. Fills the whole screen.
const { makeHall } = require('./_hall');
const WHITE = [244, 244, 246], RED = [236, 28, 36];
module.exports = makeHall({
  id: 'elekon', name: 'Elekon (hala, modré pásy)', bg: [6, 6, 8], band: [14, 44, 120], ink: WHITE, dim: [180, 182, 190], font: 'BarlowCondensed-SemiBold', labFont: 'FiraSans-Regular',
  title: { text: 'O D J E Z D Y', size: 60, color: [180, 182, 190], font: 'FiraSans-SemiBold', y: 80 },
  labels: [{ t: 'CÍLOVÁ STANICE', x: 334, y: 134, size: 24 }, { t: 'ZPOŽ.', x: 1210, y: 130, size: 20, align: 'center' }],
  top: 148, bottom: 14, group: 3, bandGap: 22, minRow: 58, maxRow: 80, tick: (f) => (f.rail && /^(R|Ex|EC|IC|rj|RJ|SC|EN|AEx|Sp)$/.test(f.kind) ? RED : null),
  cols: [
    { key: 'kind', x: 62, font: 'FiraSans-SemiBold', size: 36 }, { key: 'op', x: 150, size: 22, font: 'FiraSans-Regular', color: () => [210, 214, 232] },
    { key: 'num', x: 300, align: 'right', size: 22, font: 'FiraSans-Regular', color: () => [210, 214, 232] },
    { key: 'dest', x: 330, maxW: 590 }, { key: 'time', x: 930 }, { key: 'plat', x: 1030 }, { key: 'delay', x: 1210, align: 'center' },
  ],
});
