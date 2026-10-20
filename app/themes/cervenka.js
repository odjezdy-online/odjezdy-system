// Elektročas hall board as seen in Červenka: black frame, small "DEPARTURE", wide "O D J E Z D", "ABFAHRT" and the time with
// seconds on top, column titles (Druh vlaku, Cílová stanice – Směr jízdy, Pravidelný odjezd, Nást., Kolej, Zpoždění),
// purple-blue bands of two rows with light dot-matrix lettering, "DESTINATION-via" on one line. Imitates the look only.
const { makeHall } = require('./_hall');
const WHITE = [238, 238, 250], RED = [226, 40, 40];
module.exports = makeHall({
  id: 'cervenka', name: 'Elektročas (hala Odjezd/Abfahrt)', bg: [8, 8, 12], band: [52, 40, 168], ink: WHITE, dim: [170, 172, 190], font: 'BarlowCondensed-Medium', labFont: 'FiraSans-Regular',
  title: { text: 'O D J E Z D', size: 54, color: WHITE, font: 'BarlowCondensed-SemiBold', y: 74 },
  head(c, { T, W, s, now, api }) {
    T('DEPARTURE', 60, 62, 19, WHITE, 'FiraSans-Regular'); T('ABFAHRT', 880, 62, 19, WHITE, 'FiraSans-Regular');
    T(`${api.hhmm(now)} ${api.pad2(now.getSeconds())}`, W / s - 36, 74, 50, WHITE, 'BarlowCondensed-SemiBold', { align: 'right' });
  },
  labels: [
    { t: 'Druh', x: 50, y: 116, size: 14, color: WHITE }, { t: 'vlaku', x: 50, y: 132, size: 14, color: WHITE },
    { t: 'CÍLOVÁ STANICE  -  Směr jízdy', x: 190, y: 132, size: 22, color: WHITE },
    { t: 'Pravidelný', x: 880, y: 116, size: 14, color: WHITE }, { t: 'odjezd', x: 880, y: 132, size: 14, color: WHITE },
    { t: 'Nást.', x: 1010, y: 132, size: 14, color: WHITE }, { t: 'Kolej', x: 1090, y: 132, size: 14, color: WHITE },
    { t: 'Zpoždění', x: 1214, y: 116, size: 14, color: WHITE, align: 'center' }, { t: 'min', x: 1214, y: 132, size: 14, color: WHITE, align: 'center' },
  ],
  top: 146, bottom: 14, group: 2, bandGap: 20, minRow: 60, maxRow: 84, tick: (f) => (f.rail && /^(R|Ex|EC|IC|rj|RJ|SC|EN|AEx|Sp)$/.test(f.kind) ? RED : null), noCancelTag: true,
  cols: [
    { key: 'kind', x: 54 }, { key: 'destvia', x: 190, maxW: 660 }, { key: 'time', x: 880 }, { key: 'plat', x: 1010 }, { key: 'track', x: 1090 }, { key: 'delay', x: 1214, align: 'center' },
  ],
});
