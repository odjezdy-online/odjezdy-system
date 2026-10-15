# Odjezdy OS na Archu

Skutečný Arch Linux (systemd, pacman) s tabulí odjezdů na tty1. Žádné grafické prostředí, tabule kreslí do `/dev/fb0` (`app/board.js`).

- `profile/`: archiso profil (BIOS syslinux + UEFI GRUB), balíčky v `packages.x86_64`
- `pkg/odjezdy-board/`: PKGBUILD (nainstaluje `app/` do `/opt/odjezdy`), služba `odjezdy-board.service` a spouštěč
- `installer/odjezdy-install`: instalátor na disk (GPT, ext4, GRUB, BIOS i UEFI), po instalaci je to normální Arch
- `build.sh`: postaví balíček a ISO v privilegovaném Docker kontejneru (`arch/out/`, není v gitu)

```
arch/build.sh            # ISO v arch/out/
qemu-system-x86_64 -enable-kvm -machine q35 -m 1024 -cdrom arch/out/odjezdy-os-*.iso -vga std -nic user,model=virtio-net-pci
```

Na živém médiu: tabule na tty1, servisní konzole na Alt+F2 (root bez hesla), `odjezdy-install` na instalaci.
Instalace potřebuje internet (pacstrap); `odjezdy-board` se bere z repozitáře na médiu.
