#!/usr/bin/env bash
# shellcheck disable=SC2034

iso_name="odjezdy-os"
iso_label="ODJEZDY_$(date --date="@${SOURCE_DATE_EPOCH:-$(date +%s)}" +%Y%m)"
iso_publisher="Odjezdy OS <https://odjezdy.online>"
iso_application="Odjezdy OS (Arch Linux)"
iso_version="$(date --date="@${SOURCE_DATE_EPOCH:-$(date +%s)}" +%Y.%m.%d)"
install_dir="arch"
bootmodes=('bios.syslinux'
           'uefi.grub')
pacman_conf="pacman.conf"
airootfs_image_type="erofs"
airootfs_image_tool_options=('-zlzma,109' -E 'ztailpacking')
file_permissions=(
  ["/etc/shadow"]="0:0:400"
  ["/usr/local/bin/odjezdy-install"]="0:0:755"
)
