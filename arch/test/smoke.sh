#!/usr/bin/env bash
# Boots the ISO headless in QEMU and checks that the board is drawn (screendump is not a blank screen).
# Usage: arch/test/smoke.sh path/to/odjezdy-os.iso [WAIT_SECONDS=90]
set -euo pipefail
ISO="${1:?usage: smoke.sh ISO [wait]}"; WAIT="${2:-90}"
TMP="$(mktemp -d)"; trap 'kill "$QPID" 2>/dev/null || true; rm -rf "$TMP"' EXIT
ACCEL=(); [ -w /dev/kvm ] && ACCEL=(-enable-kvm) || WAIT=$((WAIT * 4))
qemu-system-x86_64 "${ACCEL[@]}" -machine q35 -m 1024 -cdrom "$ISO" -boot d -vga std \
  -nic user,model=virtio-net-pci -display none -qmp "unix:$TMP/qmp.sock,server=on,wait=off" &
QPID=$!
for _ in $(seq 1 "$WAIT"); do sleep 1; done
python3 -I - "$TMP/qmp.sock" "$TMP/screen.png" <<'PY'
import json, socket, sys
s = socket.socket(socket.AF_UNIX); s.connect(sys.argv[1]); f = s.makefile('rw'); f.readline()
def c(x):
    f.write(json.dumps(x) + "\n"); f.flush()
    while True:
        r = json.loads(f.readline())
        if 'return' in r or 'error' in r: return r
c({"execute": "qmp_capabilities"})
print(c({"execute": "screendump", "arguments": {"filename": sys.argv[2], "format": "png"}}))
PY
SIZE=$(stat -c %s "$TMP/screen.png")
echo "screendump: $SIZE bytes"
[ -n "${SMOKE_KEEP:-}" ] && cp "$TMP/screen.png" "$SMOKE_KEEP"
# a blank screen is ~2-3 KB as PNG; any drawn board screen (menu, error or departures) is above 5 KB
[ "$SIZE" -gt 5000 ] || { echo "FAIL: screen looks blank" >&2; exit 1; }
echo "OK: board is drawn"
