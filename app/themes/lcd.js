// Light LCD station board (blue / white, SM118 layout).
const { makeBoard } = require('./_szboard');
module.exports = makeBoard({
  id: 'lcd', name: 'LCD nádraží (světlé)', title: 'Odjezdy',
  palette: { bg: [244, 247, 251], head: [0, 70, 150], headInk: [255, 255, 255], ink: [18, 28, 50], dim: [110, 120, 140], time: [0, 70, 150], late: [200, 30, 30], ok: [20, 130, 60], rule: [190, 200, 215], row2: [90, 100, 125] },
  fonts: { head: 'FiraSans-Bold', bold: 'FiraSans-Bold', reg: 'FiraSans-Regular' },
});
