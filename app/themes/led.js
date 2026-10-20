// Amber LED station board (Elektročas-style information board): the SM118 layout drawn as round amber LEDs.
const { makeBoard } = require('./_szboard');
module.exports = makeBoard({
  id: 'led', name: 'LED nádraží (jantar)', title: 'Odjezdy', dots: 330, rowH: 62, // dense rows: more departures on the screen
  palette: { bg: [0, 0, 0], head: [0, 0, 0], headInk: [255, 176, 0], ink: [255, 176, 0], dim: [150, 100, 0], time: [255, 222, 140], late: [255, 70, 40], ok: [255, 176, 0], rule: [150, 100, 0], row2: [200, 140, 0], off: [16, 10, 4] },
  fonts: { head: 'BarlowCondensed-SemiBold', bold: 'BarlowCondensed-SemiBold', reg: 'BarlowCondensed-Medium' },
});
