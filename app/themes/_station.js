// Shared bits of the Czech station boards (gema.js, elen.js, elektrocas.js, elekon.js): one departure as the fields
// the real boards show (kind of train, number, operator, destination, direction, time, platform, delay).
const CAT = /^(EC|IC|EN|SC|AEx|Ex|R|Sp|Os|rj|RJ|LE|TLX|Rx|Pn|Nex|Mn|ES)$/;

function fields(d, api) {
  const rail = d.type === 'train' || d.type === 'rail';
  const cat = rail ? String(d.category || (CAT.test(String(d.line)) ? d.line : '') || '').trim() : '';
  return {
    rail,
    line: String(d.line ?? ''),
    // kind + number columns: Os / R / Ex + train number; buses: "Bus" (Tram, Tb, Metro) + the line number
    kind: rail ? cat || String(d.line ?? '') : { tram: 'Tram', trolleybus: 'Tb', metro: 'Metro', subway: 'Metro', ferry: 'Přívoz' }[d.type] || 'Bus',
    num: rail ? (d.trainNumber ? String(d.trainNumber) : '') : String(d.line ?? ''),
    op: rail ? d.operator || api.providerLabel(d) || '' : '',
    dest: String(d.destination || 'cíl neuveden'),
    dir: d.via?.length ? d.via[0] : '',                                           // "směr jízdy": the first stop on the way
    via: d.via?.length ? d.via.slice(0, 3).join(' – ') : '',
    time: api.hhmm(new Date(d.plannedTime || api.depTime(d))),
    plat: api.platformOf(d),
    track: (/kol(?:ej|\.)\s*([0-9A-Za-z]+)/i.exec(String(d.platform || '')) || [])[1] || '',  // "Nást. 3 / kol. 1" -> track 1
    delay: d.delayMinutes > 0 ? d.delayMinutes : 0,
    cancelled: !!d.cancelled,
    notice: api.depNotice(d)?.text || '',
  };
}

// word-for-word helper: the "no departures" message of the boards
const emptyText = (state) => (state.lastOk ? 'Žádné odjezdy' : state.error ? 'Nelze načíst odjezdy' : 'Načítám odjezdy…');

module.exports = { fields, emptyText, CAT };
