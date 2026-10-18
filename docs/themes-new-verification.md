# Nové motivy — ověření

IDs: `wiener`, `mta`, `sl`, `pid`, `fids`, `teletext`, `brutal`.
Všechny soubory motivů jsou nové, fonty nebyly přidávány. `app/board.js`,
`app/VERSION` a sdílené pomocné soubory zůstaly beze změn.

## Funkčnost a obrázky

- `node --check` pro všech sedm motivů prošel.
- 14/14 kontraktových testů: každý motiv zvládá prázdná data, načítání,
  chybu sítě, nevybranou zastávku a 1280×720 / 1920×1080; dále rotaci
  stránek, zakázané stránkování, LED fallback a nezměněné sdílené odjezdy.
- Kontrola textových native motivů zahrnuje provider, via, zrušený spoj,
  zpoždění a „cíl neuveden“ bez speciálního výstražného stylu.
- Všech sedm motivů skutečně vykresleno přes nezměněný `app/board.js --png`
  v 1280×720 a 1920×1080. Větší snímky používají vlakovou tabuli Praha hl.n.
- `docs/theme-<id>.png` jsou náhledy 1280×720; jde o **lokální ukázková data**,
  nikoli aktuální informace z provozu. Obsahují via, provider, zpoždění,
  zrušení a vlak bez cíle. Žádná síť při testech ani při vykreslování motivů.
- Jednorázový PNG test prázdného teletextu prošel i s reálným rendererem.

V sandboxu je zakázané čtení síťových rozhraní, proto testovací preload
vrací prázdný `os.networkInterfaces()`. Stejný preload dodává data přes
`global.fetch`. Tyto úpravy jsou pouze v testovacím souboru mimo aplikaci;
`app/board.js` není kvůli tomu měněn. Vykreslování běželo sekvenčně s nice 15.

## Benchmark: jeden běh na motiv

Přesný test: `W=1280 H=800 ODJEZDY_BENCH=15 node app/board.js --png ... --theme ID`.
Použity lokální vlakové fixture, zakázané přepínání stránek, nice 15, host se
souběžným provozem. Čas zahrnuje render i převod framebufferu; nejde o
měření na vyhrazeném CPU ani o čas prvního studeného snímku.

| ID | ms/frame | Stav měření |
|---|---:|---|
| wiener | 18,0 | finální kód |
| mta | 36,1 | před následnou optimalizací kruhových odznaků |
| sl | 19,5 | finální kód |
| pid | 20,6 | finální kód |
| fids | 26,5 | před odstraněním velkoplošného dvojitého překreslení řádků |
| teletext | 28,1 | před cache glyph-runů a slučováním vodorovných pixelů |
| brutal | 17,6 | finální kód |

MTA nyní kreslí kolečka po vodorovných řezech: výpočet odmocniny na řádek
místo `hypot()` pro každý pixel. FIDS má tenké oddělovače místo dodatečných
plných pásů. Teletext slučuje sousední svítící pixely a cachuje rozklad znaků
(max. 256 záznamů). Po těchto změnách znovu prošly funkční testy, syntaxe
a oba PNG rozměry, **nikoli druhý benchmark**: dodržen limit jednoho běhu
na motiv. Splnění cíle <25 ms u těchto tří finálních variant není změřené;
je to otevřený bod pro cross-review, nikoli tvrzení o dosaženém výkonu.

## Soubory k reprodukci

Pracovní kopie a testovací soubory zůstávají v `/tmp/odjezdy-themes-work/`:
`verify-themes.cjs`, `fixture.cjs`, `urban.json`, `rail.json`,
`verification/theme-<id>-1080.png`, `verification/empty-teletext.png`.
Testy: `node --test --test-isolation=none verify-themes.cjs` z této složky.

Příklad PNG z pracovní kopie (bez benchmarku):

```sh
ODJEZDY_CONFIG="$PWD/rail.json" THEME_FIXTURE=rail \
NODE_OPTIONS="--require $PWD/fixture.cjs" W=1920 H=1080 \
node app/board.js --png verification/example.png --theme fids
```

## Vizuální směr

Motivy jsou inspirované uvedenými systémy, nejsou jejich certifikované kopie.
Fira Sans / Barlow Condensed jsou volné náhrady písma, žádná oficiální loga
nebyla převzata. MTA používá rodiny barev linek; cizí linky mají neutrální
odznak. PID rozlišuje druh dopravy a barevné linky metra. Teletext má vlastní
vložené blokové znaky a pouze osm RGB barev. FIDS mění kolej na sloupec
nástupiště, nevyrábí čísla letů. Brutal je původní návrh na teplém papíru.

Referenční kontext PID: [nové digitální odjezdové panely](https://pid.cz/nove-digitalni-odjezdove-panely-informuji-o-aktualnich-odjezdech-tramvaji-a-autobusu/).
