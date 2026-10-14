# Odjezdy OS: bootovatelný Linux, který funguje jako odjezdová tabule

ISO pustíš ve VM (nebo nahraješ na USB a spustíš na starém PC či mini-PC u monitoru). Po startu systém sám načte ovladače, připojí se k síti přes DHCP a zobrazí LED tabuli odjezdů ze zvolené zastávky. Data bere z [app.odjezdy.online](https://app.odjezdy.online).

```
alpine/out/odjezdy-os.iso      ← výsledné ISO (~380 MB)
```

## Jak to spustit

| VM | Nastavení |
|---|---|
| **VirtualBox** | Typ *Linux / Other Linux (64-bit)*, 1 GB RAM, grafika VMSVGA, síť NAT, ISO připojit jako CD |
| **Hyper-V** | Generace 1 (BIOS), nebo Generace 2 s vypnutým Secure Boot, 1 GB RAM, Default Switch |
| **VMware** | *Other Linux 6.x kernel 64-bit*, 1 GB RAM |
| **QEMU** | `qemu-system-x86_64 -machine q35 -m 1024 -cdrom out/odjezdy-os.iso -vga std -nic user,model=virtio-net-pci` |

Disk není potřeba, systém běží celý z RAM jako Alpine „diskless“.

## Výběr zastávky při startu

Po každém bootu se objeví obrazovka **„Kam to dnes bude“**. Nabízí:
- volbu „Pokračovat“ s poslední zastávkou,
- naposledy použité zastávky,
- předvolby (Praha Florenc, Hlavní nádraží, Anděl, Náměstí Republiky, Brno, Olomouc, Pardubice, Plzeň, Ústí n.L.),
- „Hledat jinou zastávku…“.

Ovládá se šipkami a Enterem, číslem nebo rovnou psaním názvu. Když nikdo nic nezmáčkne, za 20 s se spustí první volba, takže tabule naběhne i bez obsluhy. Když je zastávka zadaná parametrem jádra (`odjezdy.stop=`), menu se přeskočí.

## Tabule

- Odjezdy jsou rozdělené na stránky, které se samy střídají po 8 s. Číslo stránky („2/4“) je v záhlaví. Na stránce je aspoň 5 odjezdů, na 720p/800p obvykle 7–9.
- Zpoždění je malým řezem pod časem odjezdu: `+3 min`, nebo `-1 min`, když spoj jede dřív (zeleně). Od 5 minut je červené.
- Výluka nebo náhradní doprava (linky PID na X) má pod cílem druhý řádek menším řezem (řez 1, jako řádek „zastávka“ na BUSE panelu). Dlouhý text na něm běží.
- Výluky celé zastávky běží v pruhu dole.

## Ovládání tabule (klávesnice)

| Klávesa | Akce |
|---|---|
| `S` / `Enter` | zpět do menu výběru zastávky |
| `1`–`9` | rychlé přepnutí na naposledy použité zastávky |
| `Esc` | zpět na tabuli |
| `Q` | ukončit tabuli a otevřít shell (`exit` ji spustí znovu) |
| `Alt+F2` | servisní konzole, login `root` (bez hesla) |

Zastávku jde zadat i natvrdo při bootu: v menu zavaděče stiskni `Tab` a připiš `odjezdy.stop=Hlavni_nadrazi`.

## Jak to funguje

```
BIOS/UEFI → isolinux / GRUB → Linux 6.18 LTS (všechny ovladače: virtio, bochs, vmwgfx, hyperv, e1000 …)
  → Alpine initramfs najde na médiu odjezdy.apkovl.tar.gz (náš overlay) a rozbalí ho do RAM
  → OpenRC: mdev/hwdrivers načte ovladače, networking (DHCP)
  → /etc/inittab spustí na tty1 /opt/odjezdy/start.sh
      → nainstaluje Node.js z média (offline, podepsané Alpine balíčky v /odjezdy/pkgs)
      → počká na /dev/fb0, synchronizuje čas (ntpd)
      → node board.js: data z odjezdy.online → LED matice → přímo do framebufferu (/dev/fb0)
```

- **Žádné X ani prohlížeč.** `app/board.js` kreslí LED body přímo do framebufferu. Na Windows/macOS ho jde pustit s `--png out.png` a výsledek si prohlédnout.
- **Font** je skutečný BUSE panelový font z odjezdy.online (`/cedulomat/font.fnt`, formát OMSI BUSE TOOL). Převádí ho `tools/fnt2json.js`.
- **Index zastávek** (43 tisíc zastávek, `app/stops.json.gz`) je přibalený, takže vyhledávání funguje i bez fulltextu na API.

## Build

Potřebuješ Node 18+ a Python 3 s `pycdlib` (`pip install pycdlib`). Na Windows stačí, Docker ani WSL nejsou potřeba.

```
node alpine/build.js --stop "Florenc"
```

Build stáhne Alpine 3.24 standard ISO a Node.js s jeho závislostmi z APKINDEX, vyrobí overlay a přes `remaster.py` vše vloží do ISO. Bootování přes BIOS (isolinux) i UEFI (GRUB) zůstane zachované.

Nástroje pro vývoj:
- `tools/fnt2json.js`: převod BUSE fontu
- `tools/vmctl.js`: screenshoty a klávesy do QEMU přes monitor (`-monitor tcp:127.0.0.1:4444,server,nowait`)
- `tools/build-regions.js`: přiřazení zastávek k obcím, okresům a krajům (`app/regions.json.gz`)
