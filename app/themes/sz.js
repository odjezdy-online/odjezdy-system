// SŽ station board (layout after the SM118 standard): black LCD, white letters, yellow times, analog clock.
const { makeBoard } = require('./_szboard');
module.exports = makeBoard({
  id: 'sz', name: 'SŽ tabule (SM118)', title: 'Odjezdy',
  palette: { bg: [6, 8, 12], head: [20, 44, 96], headInk: [245, 245, 245], ink: [240, 240, 240], dim: [150, 156, 168], time: [255, 214, 0], late: [255, 96, 64], ok: [120, 220, 120], rule: [64, 70, 84], row2: [170, 176, 190] },
  fonts: { head: 'BarlowCondensed-SemiBold', bold: 'BarlowCondensed-SemiBold', reg: 'FiraSans-Regular' },
});
