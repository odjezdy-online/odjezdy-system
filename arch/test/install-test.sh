#!/usr/bin/env bash
# Installs the ISO onto an empty virtual disk with `odjezdy-install --json`, checks the JSON progress
# contract, then boots the installed system from that disk and checks that the board is drawn.
# Needs internet (pacstrap downloads packages), qemu, python3.
# Usage: [DESKTOP=kiosk|plasma|gnome|xfce] arch/test/install-test.sh ISO [bios|uefi]
#   with DESKTOP the installed system is the Wayland kiosk variant: tty1 must draw the board (cage + odjezdy-wl),
#   tty2 something else (login/display manager), and the kiosk service must be active (diagnostics go to serial)
set -euo pipefail
ISO="${1:?usage: install-test.sh ISO [bios|uefi]}"; MODE="${2:-bios}"; DESKTOP="${DESKTOP:-none}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"; trap 'kill "$QPID" 2>/dev/null || true; [ -n "${KEEP:-}" ] || rm -rf "$TMP"' EXIT
ACCEL=(); K=1; [ -w /dev/kvm ] && ACCEL=(-enable-kvm) || K=4
QMP="$TMP/qmp.sock"; SER="$TMP/serial.log"
MEM=2048; DISKSZ=6G
[ "$DESKTOP" = none ] || { MEM=3072; DISKSZ=12G; }
qemu-img create -q -f raw "$TMP/disk.img" "$DISKSZ"

FW=()
if [ "$MODE" = uefi ]; then
  CODE=""; VARS=""
  for d in /usr/share/edk2/x64 /usr/share/OVMF /usr/share/edk2/ovmf /usr/share/qemu; do
    for c in OVMF_CODE.4m.fd OVMF_CODE_4M.fd OVMF_CODE.fd; do [ -f "$d/$c" ] && CODE="$d/$c" && break; done
    for v in OVMF_VARS.4m.fd OVMF_VARS_4M.fd OVMF_VARS.fd; do [ -f "$d/$v" ] && VARS="$d/$v" && break; done
    [ -n "$CODE" ] && [ -n "$VARS" ] && break
  done
  if [ -z "$CODE" ] || [ -z "$VARS" ]; then echo "OVMF firmware not found" >&2; exit 1; fi
  cp "$VARS" "$TMP/vars.fd"
  FW=(-drive "if=pflash,format=raw,readonly=on,file=$CODE" -drive "if=pflash,format=raw,file=$TMP/vars.fd")
fi

start() {   # start QEMU with the given extra drive arguments
  : > "$SER"
  qemu-system-x86_64 "${ACCEL[@]}" -machine q35 -m $MEM "${FW[@]}" "$@" \
    -drive "file=$TMP/disk.img,format=raw,if=virtio" -vga std -nic user,model=virtio-net-pci \
    -display none -serial "file:$SER" -qmp "unix:$QMP,server=on,wait=off" &
  QPID=$!
  for _ in $(seq 1 30); do [ -S "$QMP" ] && break; sleep 1; done
}
wait_for() {   # wait_for PATTERN SECONDS
  for _ in $(seq 1 "$2"); do grep -aq "$1" "$SER" && return 0; sleep 1; done
  return 1
}

echo "== $MODE: boot the live ISO"
start -cdrom "$ISO" -boot d
sleep $((50 * K))
python3 "$HERE/qmp.py" "$QMP" key alt+f2; sleep 3
# the live default keymap is cz (QWERTZ) and qmp.py types US key positions: switch with a command
# that survives that (the Y key position produces "z" on cz, hence the odd spelling)
python3 "$HERE/qmp.py" "$QMP" type 'loadkezs us\n'; sleep 2
python3 "$HERE/qmp.py" "$QMP" type "odjezdy-install --json --disk /dev/vda --yes --root-password test --desktop $DESKTOP > /dev/ttyS0 2>&1; echo INSTALL-EXIT-\$? > /dev/ttyS0\n"
wait_for 'INSTALL-EXIT-' $((900 * K)) || { echo "FAIL: installer did not finish"; tail -c 2000 "$SER" | tr -d '\000'; exit 1; }
kill "$QPID"; wait "$QPID" 2>/dev/null || true

echo "== check the JSON progress contract"
tr -d '\000\r' < "$SER" | python3 -I -c '
import json, sys
lines = [l for l in sys.stdin.read().split("\n") if l.strip()]
exit_line = [l for l in lines if l.startswith("INSTALL-EXIT-")]
assert exit_line and exit_line[-1] == "INSTALL-EXIT-0", ("installer exit", exit_line)
# (UEFI firmware and GRUB also write to the serial port: only the JSON lines belong to the installer)
objs = [json.loads(l) for l in lines if l.startswith("{")]
assert objs, "no JSON output"
assert all("error" not in o for o in objs), [o for o in objs if "error" in o]
stages = {"partition", "format", "pacstrap", "config", "bootloader", "done"}
last = -1.0
for o in objs:
    assert o["stage"] in stages, o
    assert isinstance(o["message"], str) and o["message"], o
    assert 0 <= o["progress"] <= 1, o
    assert o["progress"] >= last, ("progress went back", o)
    last = o["progress"]
assert objs[-1] == {"stage": "done", "progress": 1, "message": objs[-1]["message"]}, objs[-1]
n = sum(1 for o in objs if o["stage"] == "pacstrap")
assert n > 10, ("too few pacstrap progress lines", n)
print("OK:", len(objs), "progress lines,", n, "in pacstrap")
'

echo "== $MODE: boot the installed system from the disk (desktop: $DESKTOP)"
start
if [ "$DESKTOP" != none ]; then
  sleep $((150 * K))
  python3 "$HERE/qmp.py" "$QMP" shot "$TMP/vt1.png" >/dev/null
  python3 "$HERE/qmp.py" "$QMP" key ctrl+alt+f2; sleep $((10 * K))
  python3 "$HERE/qmp.py" "$QMP" shot "$TMP/vt2.png" >/dev/null
  [ -n "${SMOKE_KEEP:-}" ] && cp "$TMP/vt2.png" "${SMOKE_KEEP%.png}-vt2.png"
  # best-effort diagnostics: log in on tty2 (we are on it) and dump the kiosk state to the serial port
  python3 "$HERE/qmp.py" "$QMP" type 'root\n'; sleep 5
  python3 "$HERE/qmp.py" "$QMP" type 'test\n'; sleep 8
  python3 "$HERE/qmp.py" "$QMP" type 'loadkezs us\n'; sleep 2
  # (qmp.py cannot type braces: a subshell in parentheses it is)
  python3 "$HERE/qmp.py" "$QMP" type '( echo DIAG-START; systemctl is-active odjezdy-kiosk; systemctl status odjezdy-kiosk --no-pager; journalctl -u odjezdy-kiosk --no-pager | grep -v "drm.c\|pci id\|libseat\|pam_unix\|session" | tail -70; ls -la /run/user/0 /dev/input; pgrep -a cage; pgrep -a odjezdy-wl; pgrep -a node; echo DIAG-END ) > /dev/ttyS0 2>&1\n'
  wait_for 'DIAG-END' $((30 * K)) || echo "(no diagnostics: the login on tty2 did not take the keys)"
  tr -d '\000\r' < "$SER" | sed -n '/DIAG-START/,/DIAG-END/p' | tail -100
  S1=$(stat -c %s "$TMP/vt1.png"); S2=$(stat -c %s "$TMP/vt2.png")
  echo "tty1 shot: $S1 bytes, tty2 shot: $S2 bytes"
  [ -n "${SMOKE_KEEP:-}" ] && cp "$TMP/vt1.png" "${SMOKE_KEEP%.png}-vt1.png"
  [ "$S1" -gt 5000 ] || { echo "FAIL: tty1 shows no board" >&2; exit 1; }
  cmp -s "$TMP/vt1.png" "$TMP/vt2.png" && { echo "FAIL: tty2 looks like tty1 (no login / display manager)" >&2; exit 1; }
  if grep -aq DIAG-END "$SER"; then   # only judged when the diagnostics arrived; the screenshots are the main check
    tr -d '\000\r' < "$SER" | grep -qx 'active' || { echo "FAIL: odjezdy-kiosk is not active" >&2; exit 1; }
  fi
  echo "OK: $DESKTOP install boots, board on tty1, something else on tty2"
  exit 0
fi
sleep $((70 * K))
python3 "$HERE/qmp.py" "$QMP" shot "$TMP/screen.png" >/dev/null
SIZE=$(stat -c %s "$TMP/screen.png")
[ -n "${SMOKE_KEEP:-}" ] && cp "$TMP/screen.png" "$SMOKE_KEEP"
echo "screendump: $SIZE bytes"
[ "$SIZE" -gt 5000 ] || { echo "FAIL: the installed system shows no board" >&2; exit 1; }
echo "OK: $MODE install boots and draws the board"
