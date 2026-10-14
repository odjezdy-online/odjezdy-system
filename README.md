# odjezdy-system

Náhodný vibecoded systém pro lidi, kteří prostě chtějí mít odjezdovou tabuli na počítači jako systém.

Počítač (VM, starý notebook, mini-PC u monitoru) nabootuje rovnou do **LED odjezdové tabule** s živými daty z [odjezdy.online](https://app.odjezdy.online). Ve výchozím stavu používá skutečný BUSE panelový font, ale umí i vzhled tabulí z jiných zemí.

![Odjezdy OS ve VM](docs/screenshot-vm.png)

## Varianty

| | Stav | Pro koho |
|---|---|---|
| [`alpine/`](alpine/README.md): **live ISO** | hotové, bootuje v QEMU | Rychle vyzkoušet. Běží z RAM (~380 MB ISO, 1 GB RAM), nic neinstaluje. |
| `arch/`: **plnohodnotný OS s instalátorem** | ve vývoji | Normální Arch Linux (pacman, systemd), instalace na disk, GUI tabule jako hlavní rozhraní. |

Obě varianty používají stejnou aplikaci z [`app/`](app/). Tabule kreslí body přímo do framebufferu (`/dev/fb0`), bez X serveru a bez prohlížeče.

## Vzhledy tabulí

Vzhled se přepíná klávesou **T** nebo v úvodním menu. Většina vzhledů se sama přizpůsobí druhu zastávky: nádraží (čas, vlak, kolej) se zobrazuje jinak než zastávka MHD (linka, cíl, minuty).

| BUSE (Česko) | UK National Rail | Deutsche Bahn |
|---|---|---|
| ![](docs/theme-buse.png) | ![](docs/theme-uk-rail.png) | ![](docs/theme-db-rail.png) |
| **UK: Countdown (bus)** | **DB: městská zastávka** | **SBB (Švýcarsko)** |
| ![](docs/theme-uk.png) | ![](docs/theme-db-city.png) | ![](docs/theme-sbb-rail.png) |
| **RATP SIEL (Paříž)** | **JR (Japonsko)** | **Výběr podle kraje** |
| ![](docs/theme-ratp.png) | ![](docs/theme-jr.png) | ![](docs/browse-0.png) |
| **Mimořádnost** | **Nastavení vzhledu** | |
| ![](docs/alert.png) | ![](docs/settings.png) | |

Při mimořádnosti (výluka zastávky, zrušený spoj) se přes jakýkoli vzhled pravidelně ukáže celoobrazovkové oznámení **Mimořádnost**. V nastavení jde vypnout.

Vlastní vzhled zvládne kdokoli. Je to jeden JS soubor, návod je v **[docs/THEMES.md](docs/THEMES.md)**.

## Ovládání

| Klávesa | Akce |
|---|---|
| `S` / `Enter` | menu: poslední zastávka, předvolby, **výběr podle kraje → okresu → obce**, hledání |
| `T` | další vzhled tabule |
| myš | kurzor, klikání v menu, kolečko listuje, pravé tlačítko = zpět (v nastavení jde kurzor vypnout) |
| `1`–`9` | rychlé přepnutí na naposledy použité zastávky |
| `Q` | ukončit tabuli a otevřít shell (`exit` ji spustí znovu) |
| `Alt+F2` | servisní konzole |

## Struktura

```
app/            aplikace tabule (Node.js, bez závislostí)
  board.js      data, vykreslování LED/LCD matice, menu, výběr zastávky
  themes/       vzhledy tabulí (buse, uk, db, sbb, ratp, jr) a _util.js
  font.json     BUSE panelový font převedený z odjezdy.online (tools/fnt2json.js)
  stops.json.gz index 43 tisíc zastávek
  regions.json.gz  kraje → okresy → obce se zastávkami (tools/build-regions.js)
alpine/         live ISO (Alpine Linux 3.24, diskless), build na Windows/macOS/Linux
tools/          převod fontu, stavba indexu krajů, ovládání QEMU (screenshoty)
docs/           návody a screenshoty
```

Aplikace jde vyzkoušet bez VM, vyrenderuje jeden snímek do PNG:

```
cd app && node board.js --png out.png --theme db
```

## Data a zdroje

- Odjezdy, výluky a zastávky v Česku: [odjezdy.online](https://app.odjezdy.online) (PID, DÚK, IDSJMK, ODIS, CIS JŘ a další).
- Zastávky ve světě a čísla vlaků: [Transitous](https://transitous.org) (MOTIS 2 API, komunitní služba pro open-source a nekomerční projekty). **Zdroje dat: [transitous.org/sources](https://transitous.org/sources/)**, tabule je uvádí ve stavovém řádku. Transitous využívá i data © přispěvatelů OpenStreetMap.
- BUSE font: `/cedulomat/font.fnt` z odjezdy.online, formát z OMSI BUSE TOOL.
- Obce, okresy a kraje: číselníky ČSÚ se souřadnicemi obcí (souradnice.csv z [33bcdd/souradnice-mest](https://github.com/33bcdd/souradnice-mest)). V repu je jen odvozené přiřazení zastávek.

## Licence

Kód je pod licencí [MIT](LICENSE). Data mají vlastní podmínky zdrojů (viz výše). Data z Transitous se smí používat jen nekomerčně.
