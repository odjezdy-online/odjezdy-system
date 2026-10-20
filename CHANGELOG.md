# Změny

Poznámky k vydání se berou odsud (sekce `## verze`) a ukazuje je i obrazovka Aktualizace v tabuli, proto jsou krátké a česky.

## 0.5.17
- Změna velikosti okna virtuálního počítače (např. na 1920×1080) se teď projeví: tabule si při změně preferovaného rozlišení restartuje a nastaví ho sama
- Natvrdo přeložený pomocník pro režim obrazovky je součástí balíčku aplikace i živého ISO (Alpine)
- JR a LED jantar: hustší řádky, víc odjezdů na obrazovce
- Wayland: při změně velikosti okna tabule nekončí, ale pokračuje s novou obrazovkou; důvody ukončení se zapisují do záznamu

## 0.5.16
- Správa na dálku: webová stránka na portu 8080 s heslem (stav, zastávka, vzhled, jas, restart, aktualizace, záznam); adresa a heslo jsou v menu „Správa na dálku (web)…“
- Plán zapnutí a jasu: pravidla podle dnů a času, jas 0 = zhasnuto
- Vzhled DB: berlínské barvy linek S-Bahn a U-Bahn, štítky RB/RE/ICE, symboly U-Bahn a tramvaje
- Živé ISO načte i ovladač VirtualBoxu (vboxguest) kvůli více monitorům

## 0.5.15
- Vzhled DB blíž stránce bahnhof.de (barvy, šířka, symboly ve filtru, čipy „i“ a Fahrtinformationen)
- Živé ISO si před startem tabule načte ovladač grafické karty (kvůli více monitorům ve VirtualBoxu)

## 0.5.14
- Stejný vlak z PID a ČD/DÚK se ukáže jednou (číslo vlaku, nástupiště a zpoždění z ČD, označení linky z PID)
- Mimořádnost nahradí odjezdy na celé obrazovce v barvách a písmu vzhledu
- Související hlášení jen podle linky, s uvedením linek, kterých se týkají (už nevypadají jako výluka celé zastávky)
- Klávesa V ukáže i paměť a dobu běhu tabule

## 0.5.13
- Další vzhledy podle fotek nádražních tabulí: Praha hl.n. (velká modrá hala), Praha-Masarykovo (příjezdy), Gema Přeštice, Elen Děčín, Česká Třebová a Otrokovice
- U autobusů a tramvají ve vzhledech nádražních tabulí je druh „Bus“/„Tram“ a číslo linky ve sloupci čísla

## 0.5.12
- Nové vzhledy podle českých nádražních tabulí: Gema (hala), Elen (hala s LED body a tabule kolejí), Elektročas (nástupiště a hala Odjezd/Abfahrt), Elekon, SŽDC s hodinami, autobusy + vlaky
- Obecné vzhledy podle normy SŽ SM118: SŽ tabule, LCD nádraží (světlé), LED nádraží (jantar)
- Halové vzhledy vyplní celou obrazovku, sloupec Zpoždění je vycentrovaný pod nadpisem

## 0.5.11
- U vlaků bez nástupiště se ukáže ikonka vlaku (ve všech vzhledech)
- Číslo vlaku jako drobný text („Os 6925“, „č. 678“)
- Názvy zastávek a cílů bez dvojitých čárek a se správnými mezerami („Ústí n.L. hl.n.“)
- Dlouhá hodnota nástupiště („3 / kolej 2“) se zkrátí nebo vejde do odznaku
- Opraveno: seznam v menu při pohybu myší nejel až nahoru

## 0.5.10
- Oznámení ukáže odkaz na zdroj hlášení a názvy příloh (PDF), když je dopravce uvedl
- Shrnutí hlášení teď vychází i z příloh dopravce (server)

## 0.5.9
- Oznámení ukáže pod podrobnostmi původní znění hlášení od dopravce (DÚK, SŽ, ČD, PID), když je místo
- Ukazují se i související výluky: hlášení, která se týkají linek jedoucích přes zastávku (např. objížďka linek 480 a 490 v Teplicích), nejvýš 3 najednou
- Podrobnosti hlášení využijí celé volné místo na LED displejích

## 0.5.8
- Podrobnosti hlášení se na celoobrazovém oznámení už neusekávají, využijí celé volné místo
- Dlouhé nadpisy výluk vlaků (ČD) se vejdou celé
- BUSE: řádek se zpožděním na konci stránky se přesune na další stránku místo zmenšení
- BUSE: sloupec linky se rozšíří pro dlouhá čísla linek (např. zahraniční 1398)
- Vzhledy už neukazují zdroj dat JDF jako dopravce, DUK se píše „DÚK“

## 0.5.7
- Krátké hlášení v pruhu se už nezobrazuje dvakrát za sebou
- Hlášení bez podrobností se doplní celým textem z popisu, takže se už nezkracuje („PRODLOUŽ…“)

## 0.5.6
- Zpožděné spoje zůstávají na tabuli až do skutečného odjezdu, ne jen do plánovaného času
- Běžící text pokračuje i při zobrazené mimořádnosti, celá tabule se nesekne
- Běžící text v LED vzhledech se posouvá rovnoměrně o jeden bod
- Automatická kvalita obrazu se po zlepšení výkonu vrací na plnou
- Opraven fialový blok v běžícím pruhu a přetékání textu oznámení

## 0.5.5
- Opraveno skákání běžícího textu zpět na začátek při překreslení vzhledu
- Tabule už nezapisuje celý snímek každé 2 s (škubnutí ve virtuálních počítačích)
- Nová volba Kvalita obrazu (automatická, plná, poloviční, třetinová)
- Klávesa V ukáže čísla výkonu (snímky za sekundu, doba vykreslení a zápisu)
- Rychlejší vykreslování ploch a zaoblených obdélníků

## 0.5.4
- Plynulý posun běžícího textu v PID vzhledech, i když je počítač nebo VM pomalé
- Rychlejší vykreslování ploch

## 0.5.3
- Opraveno přetékání vzhledů na displejích 16:10 a 4:3 (např. ČD klapky na 1280×800)
- Mimořádnosti se ukážou, až když platí nebo začínají do 36 hodin
- Hlášení jiného dopravce už se neukazuje u cizí zastávky (DÚK hlášení v Praze)
- Doba platnosti jednodenního hlášení: „Platí 31. 10. 6:30–17:30“

## 0.5.2
- Vzhled PID přepsán podle skutečného virtuálního tabla PID (ikony vozíčku a klimatizace, ikony metra, logo)
- Nový vzhled PID tablo (LCD zastávkové tablo)
- U dat PID se uvádí zdroj „PID (Golemio)“, oznámení PID (infotexts) se ukazují v pruhu hlášení
- Písmo Prague Citizen se použije, když je nainstalované, jinak Fira Sans

## 0.5.1
- Mimořádnosti se už neusekávají: běžící text i oznámení ukážou celý text hlášení
- Oznámení má shrnutí, podrobnosti a dobu platnosti („Platí od … do …“)
- Krátká shrnutí hlášení zpracovaná serverem (ne zkrácený nadpis zdroje)

## 0.5.0
- 9 nových vzhledů: ČD hala a ČD klapky, Wiener Linien, MTA, SL, PID, letištní tabule, Teletext, Brutal
- Výběr vzhledu ze seznamu s náhledem
- Instalace do počítače: přehled kroků, log a spolehlivý ukazatel, oprava odpojení disku
- Dopravce je v DB a SBB vzhledu v samostatné poličce
- Oprava: pozdní odpověď pro předchozí zastávku už nepřepíše novou tabuli
- Oprava: nástupiště „Kol. 12“ se ukáže jako 12

## 0.4.3
- U spojů je dopravce a zastávky „přes“
- Nová volba Stránkování: jen první stránka, bez přepínání
- Rychlejší vykreslování na pomalých a virtuálních počítačích
- Vlaky bez známého cíle ukazují „cíl neuveden“
- Instalace do počítače s volbou jazyka, klávesnice a časového pásma
- Obrazovka Wi-Fi a průvodce prvním spuštěním

## 0.4.2
- Nové vzhledy: NS, Solari, Neon, E-ink, Zelená LED
- Mimořádnost se ukazuje jednou za 2 minuty, celé hlášení i s důvodem
- Při restartu na živém médiu se aktualizace už nenabízí sama

## 0.4.1
- Offline režim: tabule ukáže poslední známé odjezdy
- Záloha dat přes Transitous při výpadku odjezdy.online
- Nové API odjezdy.online (jeden dotaz na všechna nástupiště)
- Arch ISO v každém vydání

## 0.4.0
- První vydání s aktualizací z GitHubu
