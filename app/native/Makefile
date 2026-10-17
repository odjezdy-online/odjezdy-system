# odjezdy-kms: multi-monitor output helper (needs libdrm headers: Arch "libdrm", Alpine "libdrm-dev")
CFLAGS ?= -O2 -Wall -Wextra
PKG_CFLAGS := $(shell pkg-config --cflags libdrm)
PKG_LIBS := $(shell pkg-config --libs libdrm)

odjezdy-kms: odjezdy-kms.c
	$(CC) $(CFLAGS) $(PKG_CFLAGS) -o $@ $< $(PKG_LIBS)

clean:
	rm -f odjezdy-kms
.PHONY: clean
