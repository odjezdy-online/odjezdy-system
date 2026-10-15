# Vlastní vzhled tabule (theme)

Vzhled je jeden soubor `app/themes/<id>.js`. Tabule načte všechny soubory v té složce automaticky, nic jiného se registrovat nemusí. Soubory začínající `_` (např. `_util.js`) jsou pomocné a jako vzhled se nenačítají.

Vlastní vzhledy jde přidat i bez úpravy systému:

- `/etc/odjezdy/themes/*.js` pro všechny uživatele (instalovaný systém),
- `~/.config/odjezdy/themes/*.js` pro jednoho uživatele.

## Minimální vzhled

```js
// app/themes/muj.js
const { paginate, emptyMessage, clockText } = require('./_util');

module.exports = {
  id: 'muj',                 // přepínač T / odjezdy.theme=muj na příkazové řádce jádra
  name: 'Můj vzhled',        // jméno v menu
  style: 'led',              // 'led' = body s mezerami, 'lcd' = plné pixely (LCD obrazovky)
  background: [0, 0, 0],     // barva pozadí
  unlit: [20, 12, 0],        // barva nesvítících bodů (u LCD obvykle = background)
  colors: { 1: [0, 255, 120] }, // přebarvení slotů (viz níže)

  render(m, t, api) {
    const { C, state, fitText, hhmm, minutesTo } = api;
    m.text(api.stopLabel(state.cfg.stop), 2, 2, 'big', C.AMBER);
    m.textRight(clockText(api), m.cols - 2, 2, 'normal', C.DIM);

    const deps = api.upcoming();
    if (!deps.length) { m.textCenter(emptyMessage(api)[0], 40, 'normal', C.AMBER); return; }

    const pg = paginate(deps, 6, t);            // 6 řádků na stránku, střídání po 8 s
    pg.items.forEach((d, i) => {
      const y = 28 + i * 14;
      m.text(String(d.line), 2, y, 'normal', C.AMBER);
      m.text(fitText(d.destination, 'normal', m.cols - 80), 30, y, 'normal', C.AMBER);
      m.textRight(`${Math.max(0, minutesTo(d))} min`, m.cols - 2, y, 'normal', C.WHITE);
    });
  },
};
```

Vyzkoušení bez VM (vyrenderuje jeden snímek):

```
cd app && node board.js --png muj.png --theme muj
W=1024 H=768 node board.js --png muj-43.png --theme muj     # jiné rozlišení
node board.js --png muj-start.png --theme muj --start       # úvodní menu ve tvém vzhledu
```

## Plátno `m`

Matice má zhruba 256 sloupců (`m.cols`) a 144–192 řádků (`m.rows`) podle rozlišení. Jeden bod = jedna LED.

| Funkce | |
|---|---|
| `m.text(str, x, y, face, color, clipX0?, clipX1?)` | text od bodu x,y (levý horní roh); vrací x za textem |
| `m.textRight(str, right, y, face, color)` | zarovnání vpravo k `right` |
| `m.textCenter(str, y, face, color)` | na střed |
| `m.hline(x0, x1, y, color)` | vodorovná čára |
| `m.set(x, y, color)` | jeden bod; `color = 0` = pozadí (vyříznutí textu z plochy) |

**Fonty (`face`)**: `'small'` a `'normal'` (10 bodů), `'big'` (19 bodů), `'line'` (19 bodů, čísla linek). Je to skutečný BUSE font. Pozor: `?` a `<` jsou v něm piktogramy.

**Barvy** jsou sloty `api.C`. Vzhled je přebarví v `colors`:

| Slot | Výchozí význam |
|---|---|
| `C.AMBER` (1) | hlavní text |
| `C.DIM` (2) | popisky, vedlejší text |
| `C.RED` (3), `C.GREEN` (4), `C.WHITE` (5), `C.BLUE` (6), `C.YELLOW` (7), `C.ORANGE` (8), `C.GREY` (9), `C.ACCENT` (10) | |

## `api`

| | |
|---|---|
| `state.deps` | odjezdy: `{ line, destination, platform, plannedTime, expectedTime, delayMinutes, type, provider }` |
| `upcoming()` | odjezdy, které ještě neodjely |
| `minutesTo(d)`, `depTime(d)`, `hhmm(date)`, `pad2(n)` | čas |
| `platformOf(d)` | nástupiště / kolej bez „Nástupiště“ a bez nesmyslů jako „N/A“ |
| `hasDelay(d)`, `delayLabel(d)`, `delayColor(d)` | zpoždění („+3 min“ / „-1 min“) |
| `depNotice(d)` | výluka nebo náhradní doprava k danému spoji (`{ text, color }` nebo `null`) |
| `state.alerts` | výluky celé zastávky (texty) |
| `state.cfg.stop`, `stopLabel(stop)` | zvolená zastávka a její jméno (s městem, když je víc stejných) |
| `textWidth(str, face)`, `fitText(str, face, maxW)`, `faceCovers(face, str)` | měření textu a zkracování „…“ |
| `statusText()` | „aktualizováno 21:24“ / „bez spojení (…)“ |

`_util.js` navíc nabízí `paginate`, `box`, `badge` (text v rámečku), `marquee` (běžící text), `emptyMessage`, `clockText`, `boardKind` (`'rail'` nádraží / `'urban'` MHD) a `countdown`.

`t` je čas v ms od startu. Hodí se na stránkování, blikání a běžící text.

## Přispět vzhledem do repa

1. Fork a nový soubor `app/themes/<id>.js`.
2. Vyrenderuj screenshoty (720p i `W=1024 H=768`, ideálně nádraží i zastávku MHD) a přidej je do `docs/theme-<id>.png`.
3. Otevři pull request. Do popisu napiš, jakou skutečnou tabuli vzhled napodobuje (odkaz na fotku pomůže).

Pravidla: žádné síťové požadavky ani soubory mimo `render()`, vykreslení snímku pod ~20 ms, zvládnout prázdný seznam i chybu sítě (`emptyMessage`).
