#!/usr/bin/env bash
# Builds odjezdy-os-*.iso (Arch Linux, archiso) inside a privileged Arch container.
# Usage: arch/build.sh [OUT_DIR]     (default: arch/out, git-ignored)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
OUT="${1:-$HERE/out}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

docker run --rm --privileged \
  -v "$REPO":/src:ro -v "$OUT":/out \
  -e SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git -C "$REPO" log -1 --format=%ct 2>/dev/null || date +%s)}" \
  -e ODJEZDY_DU="${ODJEZDY_DU:-}" -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  archlinux:latest bash -euo pipefail -c '
    pacman -Syu --noconfirm --needed archiso base-devel git grub mtools dosfstools libdrm wayland wayland-protocols >/dev/null
    useradd -m builder 2>/dev/null || true

    # 1) package odjezdy-board into a local repo
    mkdir -p /build/pkg /build/repo && cp -r /src/arch/pkg/odjezdy-board/. /build/pkg/
    cp -r /src/app /build/app && chown -R builder /build
    su builder -c "cd /build/pkg && ODJEZDY_APP_DIR=/build/app makepkg -f --nodeps --skipinteg >/dev/null"
    cp /build/pkg/*.pkg.tar.* /build/repo/
    repo-add /build/repo/odjezdy.db.tar.gz /build/repo/*.pkg.tar.* >/dev/null

    # 2) profile with the repo path filled in, installer and repo copy on the medium
    cp -r /src/arch/profile /build/profile
    sed -i "s|@REPO@|/build/repo|" /build/profile/pacman.conf
    install -Dm755 /src/arch/installer/odjezdy-install /build/profile/airootfs/usr/local/bin/odjezdy-install
    mkdir -p /build/profile/airootfs/srv/odjezdy-repo && cp /build/repo/* /build/profile/airootfs/srv/odjezdy-repo/

    # 3) ISO
    mkarchiso -v -w /build/work -o /out /build/profile
    if [ -n "${ODJEZDY_DU:-}" ]; then   # size report of the root filesystem (debug aid)
      mkdir -p /tmp/rootfs && fsck.erofs --extract=/tmp/rootfs /build/work/iso/arch/x86_64/airootfs.erofs >/dev/null 2>&1
      du -x --max-depth=3 -m /tmp/rootfs | sort -n | tail -25
    fi
    chown "$HOST_UID:$HOST_GID" /out/*.iso
    ls -la /out
  '
