#!/usr/bin/env python3
"""Adds the Odjezdy OS overlay + offline packages into an Alpine ISO (keeps BIOS + EFI boot).

usage: remaster.py <alpine.iso> <out.iso> <odjezdy.apkovl.tar.gz> <pkgs-dir>
"""
import io
import os
import struct
import sys

import pycdlib

src, dst, ovl, pkgdir = sys.argv[1:5]

KERNEL_ARGS_OLD = 'modules=loop,squashfs,sd-mod,usb-storage quiet'
KERNEL_ARGS_NEW = 'modules=loop,squashfs,sd-mod,usb-storage quiet loglevel=3 consoleblank=0 vt.global_cursor_default=0 no_timer_check'


def read(iso, rr_path):
    b = io.BytesIO()
    iso.get_file_from_iso_fp(b, rr_path=rr_path)
    return b.getvalue()


def iso_path_of(iso, rr_path):
    """Find the ISO9660 name of a Rock Ridge path (walk parent dir)."""
    parent, name = rr_path.rsplit('/', 1)
    for child in iso.list_children(rr_path=parent or '/'):
        if child.rock_ridge and child.rock_ridge.name() == name.encode():
            ident = child.file_identifier().decode()
            iso_parent = '/' if not parent else iso_path_of(iso, parent)
            return (iso_parent.rstrip('/') + '/' + ident)
    raise FileNotFoundError(rr_path)


def replace(iso, rr_path, data):
    ip = iso_path_of(iso, rr_path)
    joliet = rr_path if iso.has_joliet() else None
    iso.rm_file(iso_path=ip, rr_name=rr_path.rsplit('/', 1)[1], joliet_path=joliet)
    iso.add_fp(io.BytesIO(data), len(data), iso_path=ip, rr_name=rr_path.rsplit('/', 1)[1], joliet_path=joliet)


def add(iso, iso_path, rr_name, joliet_path, data):
    iso.add_fp(io.BytesIO(data), len(data), iso_path=iso_path, rr_name=rr_name, joliet_path=joliet_path)


iso = pycdlib.PyCdlib()
iso.open(src)

# --- boot menus: branding + quieter console
sys_cfg = read(iso, '/boot/syslinux/syslinux.cfg').decode()
sys_cfg = (sys_cfg.replace('MENU LABEL Linux lts', 'MENU LABEL Odjezdy OS')
                  .replace(KERNEL_ARGS_OLD, KERNEL_ARGS_NEW)
                  .replace('TIMEOUT 10', 'TIMEOUT 20'))
replace(iso, '/boot/syslinux/syslinux.cfg', sys_cfg.encode())

grub_cfg = read(iso, '/boot/grub/grub.cfg').decode()
grub_cfg = grub_cfg.replace('menuentry "Linux lts"', 'menuentry "Odjezdy OS"').replace(KERNEL_ARGS_OLD, KERNEL_ARGS_NEW)
replace(iso, '/boot/grub/grub.cfg', grub_cfg.encode())

# --- overlay picked up automatically by Alpine's initramfs (any *.apkovl.tar.gz in the medium root)
data = open(ovl, 'rb').read()
add(iso, '/ODJEZDY.TGZ;1', 'odjezdy.apkovl.tar.gz', '/odjezdy.apkovl.tar.gz', data)

# --- offline runtime packages
iso.add_directory('/ODJEZDY', rr_name='odjezdy', joliet_path='/odjezdy')
iso.add_directory('/ODJEZDY/PKGS', rr_name='pkgs', joliet_path='/odjezdy/pkgs')
for i, name in enumerate(sorted(os.listdir(pkgdir))):
    data = open(os.path.join(pkgdir, name), 'rb').read()
    add(iso, '/ODJEZDY/PKGS/P%03d.APK;1' % i, name, '/odjezdy/pkgs/' + name[:60], data)

iso.write(dst)
iso.close()

# --- sanity check: isolinux boot info table must point at the relocated file
chk = pycdlib.PyCdlib()
chk.open(dst)
rec = chk.get_record(iso_path=iso_path_of(chk, '/boot/syslinux/isolinux.bin'))
lba = rec.extent_location()
chk.close()
with open(dst, 'rb') as f:
    f.seek(lba * 2048 + 8)
    pvd_lba, file_lba, file_len = struct.unpack('<III', f.read(12))
print('isolinux.bin at LBA %d, boot info table says file LBA %d (pvd %d, len %d)' % (lba, file_lba, pvd_lba, file_len))
if file_lba != lba or pvd_lba != 16:
    sys.exit('boot info table mismatch: BIOS boot would fail')
print('ok:', dst)
