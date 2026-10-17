// Zelená LED (fictional retro terminal): the BUSE layout and font, but in green LEDs on a dark green panel,
// like an old monochrome terminal. Shows how a theme can reuse another one and only recolour it.
const buse = require('./buse');

module.exports = {
  id: 'zelena',
  name: 'Zelená LED (fiktivní)',
  style: 'led',
  background: [0, 0, 0],
  unlit: [4, 16, 6],
  colors: { 1: [90, 255, 110], 2: [30, 120, 46], 3: [255, 210, 60], 4: [140, 255, 160], 5: [210, 255, 215], 10: [255, 210, 60] },
  render: buse.render,
};
