# odjezdy-kms: multi-monitor output helper (needs libdrm headers: Arch "libdrm", Alpine "libdrm-dev")
# odjezdy-wl:  the same for Wayland desktops/kiosks (needs wayland, wayland-protocols; Arch "wayland wayland-protocols")
CFLAGS ?= -O2 -Wall -Wextra
PKG_CFLAGS := $(shell pkg-config --cflags libdrm)
PKG_LIBS := $(shell pkg-config --libs libdrm)
XDG_XML ?= $(shell pkg-config --variable=pkgdatadir wayland-protocols)/stable/xdg-shell/xdg-shell.xml

all: odjezdy-kms odjezdy-wl

odjezdy-kms: odjezdy-kms.c
	$(CC) $(CFLAGS) $(PKG_CFLAGS) -o $@ $< $(PKG_LIBS)

xdg-shell-client-protocol.h: $(XDG_XML)
	wayland-scanner client-header $< $@
xdg-shell-protocol.c: $(XDG_XML)
	wayland-scanner private-code $< $@

odjezdy-wl: odjezdy-wl.c xdg-shell-client-protocol.h xdg-shell-protocol.c
	$(CC) $(CFLAGS) -I. $(shell pkg-config --cflags wayland-client) -o $@ odjezdy-wl.c xdg-shell-protocol.c $(shell pkg-config --libs wayland-client)

clean:
	rm -f odjezdy-kms odjezdy-wl xdg-shell-client-protocol.h xdg-shell-protocol.c
.PHONY: all clean
