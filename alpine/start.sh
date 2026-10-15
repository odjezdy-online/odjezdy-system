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

# 2) graphics: wait for a framebuffer (DRM drivers are loaded by mdev/hwdrivers)
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
