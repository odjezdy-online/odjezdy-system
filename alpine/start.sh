#!/bin/sh
# Odjezdy OS — runs on tty1 (from /etc/inittab), respawned by init when it exits.
export TZ=Europe/Prague HOME=/root PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
APP=/opt/odjezdy

dmesg -n 1 2>/dev/null
printf '\033[?25l\033[2J\033[H'
echo
echo "   ODJEZDY OS"
echo "   ----------"

# 1) runtime: node + tzdata shipped on the boot medium as signed Alpine packages (works offline)
if ! command -v node >/dev/null 2>&1; then
  echo "   Instaluji runtime z instalačního média…"
  PKGDIR=""
  for d in /media/*/odjezdy/pkgs; do [ -d "$d" ] && PKGDIR="$d" && break; done
  if [ -n "$PKGDIR" ]; then
    # --force-non-repository: packages come from the medium, not from a configured repo (diskless system)
    apk add --quiet --no-network --allow-untrusted --force-non-repository "$PKGDIR"/*.apk tzdata >/tmp/apk.log 2>&1 || cat /tmp/apk.log
  else
    echo "   Balíčky na médiu nenalezeny, stahuji z internetu…"
    apk add --quiet nodejs tzdata
  fi
fi

# 2) graphics: load the real DRM driver of the GPU first. Without it the generic framebuffer (efifb/simpledrm/vesafb)
#    appears, which has exactly one screen; VirtualBox, for example, then greys out "Virtual screen 2" (it only enables extra
#    screens for guests whose driver supports several outputs: vmwgfx on VMSVGA).
for dev in /sys/bus/pci/devices/*; do
  # VirtualBox guest device (VMMDev): vboxguest lets the host talk to the guest (mode hints, which is what unlocks
  # "Virtual screen 2 > Enable"); the in-kernel vboxvideo driver of the VBoxVGA controller needs it
  [ "$(cat "$dev/vendor" 2>/dev/null):$(cat "$dev/device" 2>/dev/null)" = "0x80ee:0xcafe" ] && modprobe -q vboxguest 2>/dev/null
  case "$(cat "$dev/class" 2>/dev/null)" in 0x03*) ;; *) continue ;; esac
  case "$(cat "$dev/vendor" 2>/dev/null):$(cat "$dev/device" 2>/dev/null)" in
    0x15ad:0x0405) m=vmwgfx ;;       # VMware / VirtualBox VMSVGA
    0x80ee:0xbeef) m=vboxvideo ;;    # VirtualBox VBoxVGA
    0x1af4:*)      m=virtio-gpu ;;   # QEMU/KVM virtio
    0x1234:0x1111) m=bochs ;;        # QEMU std VGA
    0x1b36:0x0100) m=qxl ;;
    0x1414:*)      m=hyperv_drm ;;   # Hyper-V
    *)             m="" ;;
  esac
  [ -n "$m" ] && modprobe -q "$m" 2>/dev/null
done
# wait for a framebuffer (DRM drivers are loaded by mdev/hwdrivers)
i=0
while [ ! -e /dev/fb0 ] && [ $i -lt 20 ]; do
  [ $i -eq 3 ] && for m in bochs virtio-gpu vmwgfx hyperv_drm qxl cirrus-qemu simpledrm vboxvideo; do modprobe -q "$m" 2>/dev/null; done
  sleep 1; i=$((i + 1))
done
if [ ! -e /dev/fb0 ]; then
  echo "   Nenašel jsem framebuffer (/dev/fb0). Přihlas se na tty2 (Alt+F2) jako root."
  sleep 30; exit 1
fi

# 3) clock: sync time in the background once the network is up
( for n in $(seq 1 30); do ntpd -n -q -p pool.ntp.org >/dev/null 2>&1 && break; sleep 3; done ) &

setterm -blank 0 -powersave off -cursor off >/dev/null 2>&1
node "$APP/board.js"
rc=$?
printf '\033[?25h\033[2J\033[H'
if [ $rc -eq 10 ]; then
  echo "Odjezdy OS — shell. Tabuli znovu spustíš příkazem: exit"
  /bin/sh -l
fi
