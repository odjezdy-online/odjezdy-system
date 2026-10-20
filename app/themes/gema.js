// Gema hall board (Odjezdy – Abfahrt): black frame, white heading, printed column titles, yellow LED text on dark-green
// bands of three rows (R in red), filling the whole screen. Imitates the look of the board in Ústí nad Labem hl.n.
const { makeHall } = require('./_hall');
const YEL = [255, 226, 0], RED = [255, 62, 40], ORANGE = [255, 160, 20], WHITE = [236, 236, 236];
module.exports = makeHall({
  id: 'gema', name: 'Gema (hala, žluté LED)', bg: [10, 10, 10], band: [12, 62, 28], ink: YEL, dim: [190, 190, 190], font: 'BarlowCondensed-SemiBold', labFont: 'FiraSans-SemiBold',
  title: { text: 'Odjezdy - Abfahrt', size: 56, color: WHITE, font: 'FiraSans-Bold', y: 74 },
  labels: [
    { t: 'Druh', x: 44, y: 124, size: 16, color: WHITE }, { t: 'vlaku', x: 44, y: 142, size: 16, color: WHITE },
    { t: 'Číslo', x: 146, y: 124, size: 16, color: WHITE }, { t: 'vlaku', x: 146, y: 142, size: 16, color: WHITE },
    { t: 'Cílová stanice', x: 262, y: 142, size: 20, color: WHITE }, { t: 'Směr jízdy', x: 640, y: 142, size: 20, color: WHITE },
    { t: 'Pravidelný', x: 960, y: 124, size: 16, color: WHITE }, { t: 'odjezd', x: 960, y: 142, size: 16, color: WHITE },
    { t: 'Nástup.', x: 1100, y: 142, size: 16, color: WHITE }, { t: 'Zpoždění', x: 1214, y: 142, size: 16, color: WHITE, align: 'center' },
  ],
  top: 160, bottom: 16, group: 3, bandGap: 20, minRow: 56, maxRow: 78,
  cols: [
    { key: 'kind', x: 52, color: (f) => (/^(R|Ex|EC|IC|rj|RJ|SC|EN|AEx)$/.test(f.kind) ? RED : ORANGE) },
    { key: 'num', x: 150 }, { key: 'dest', x: 262, maxW: 360 }, { key: 'dir', x: 640, maxW: 300, color: (f) => (f.notice ? ORANGE : YEL) },
    { key: 'time', x: 960 }, { key: 'plat', x: 1110 }, { key: 'delay', x: 1214, align: 'center' },
  ],
});
