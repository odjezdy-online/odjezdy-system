# Změny

Poznámky k vydání se berou odsud (sekce `## verze`) a ukazuje je i obrazovka Aktualizace v tabuli, proto jsou krátké a česky.

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
