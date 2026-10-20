/*
 * odjezdy-wl: shows Odjezdy OS boards as fullscreen Wayland windows (cage, KDE Plasma, GNOME, XFCE/labwc, ...).
 *
 * Same unix-socket protocol as odjezdy-kms, so the board's output code stays the same; the compositor does the vsync
 * and the GPU work, the board keeps rendering on the CPU:
 *
 *   client: "LIST\n"     -> "OUT <n> <w> <h> <stride> <output-name>\n" ... "END\n"
 *   client: "OUT <n>\n"  -> "OK <w> <h> <stride>\n" (or "ERR <msg>\n"),
 *                           then the client sends frames of stride*h bytes (XRGB8888) back to back.
 *
 * Each client that asks for an output gets its own xdg_toplevel, fullscreen on that wl_output. <w> <h> is the size the
 * compositor gives the window (the output's size in logical pixels). If the compositor resizes the window later
 * (mode change, output removed) the client is dropped and has to ask again with "OUT <n>". A frame that arrives while
 * the compositor has not shown the previous one yet replaces it, so a slow compositor never blocks the board.
 *
 * Build: see the Makefile (wayland-client, xdg-shell from wayland-protocols).
 * Run:   odjezdy-wl [$XDG_RUNTIME_DIR/odjezdy-wl.sock]     (WAYLAND_DISPLAY from the compositor, e.g. under cage)
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>
#include <wayland-client.h>
#include "xdg-shell-client-protocol.h"

#define MAX_OUT 8
#define MAX_CLIENT 16
#define NBUF 3

struct output {
  struct wl_output *wl;
  uint32_t name_id;
  int w, h;              /* current mode in pixels */
  char name[48];
};

struct buf {
  struct wl_buffer *wl;
  uint8_t *map;
  int busy;              /* the compositor still holds it */
};

enum { ST_CMD, ST_WAITCFG, ST_FRAMES };

struct client {
  int fd, state, out;
  char line[64];
  size_t llen;
  struct wl_surface *surf;
  struct xdg_surface *xs;
  struct xdg_toplevel *top;
  int cw, ch, stride;    /* configured size */
  int configured, closed;
  struct buf bufs[NBUF];
  size_t size;
  int back;              /* buffer the next frame is read into */
  int shown;             /* buffer the compositor was last given (-1 = none) */
  int cb_pending, dirty;
  uint64_t got;
  uint8_t *scratch;      /* frames land here while no buffer is free */
};

static struct wl_display *dpy;
static struct wl_compositor *comp;
static struct wl_shm *shm;
static struct xdg_wm_base *wm;
static struct wl_seat *seat;
static struct wl_pointer *ptr;
static struct output outs[MAX_OUT];
static int nout;
static struct client clients[MAX_CLIENT];

/* ---- outputs ---- */
static void out_geometry(void *d, struct wl_output *o, int32_t x, int32_t y, int32_t pw, int32_t ph, int32_t sp, const char *mk, const char *md, int32_t tr) {
  (void)d; (void)o; (void)x; (void)y; (void)pw; (void)ph; (void)sp; (void)mk; (void)md; (void)tr;
}
static void out_mode(void *d, struct wl_output *o, uint32_t flags, int32_t w, int32_t h, int32_t r) {
  (void)o; (void)r;
  struct output *p = d;
  if (flags & WL_OUTPUT_MODE_CURRENT) { p->w = w; p->h = h; }
}
static void out_done(void *d, struct wl_output *o) { (void)d; (void)o; }
static void out_scale(void *d, struct wl_output *o, int32_t f) { (void)d; (void)o; (void)f; }
static void out_name(void *d, struct wl_output *o, const char *n) { (void)o; snprintf(((struct output *)d)->name, sizeof(((struct output *)d)->name), "%s", n); }
static void out_desc(void *d, struct wl_output *o, const char *n) { (void)d; (void)o; (void)n; }
static const struct wl_output_listener out_l = { out_geometry, out_mode, out_done, out_scale, out_name, out_desc };

static void wm_ping(void *d, struct xdg_wm_base *b, uint32_t serial) { (void)d; xdg_wm_base_pong(b, serial); }
static const struct xdg_wm_base_listener wm_l = { wm_ping };

/* a board has no use for a mouse cursor: hide it whenever the pointer is over one of our windows */
static void ptr_enter(void *d, struct wl_pointer *p, uint32_t serial, struct wl_surface *sf, wl_fixed_t x, wl_fixed_t y) { (void)d; (void)sf; (void)x; (void)y; wl_pointer_set_cursor(p, serial, NULL, 0, 0); }
static void ptr_leave(void *d, struct wl_pointer *p, uint32_t serial, struct wl_surface *sf) { (void)d; (void)p; (void)serial; (void)sf; }
static void ptr_motion(void *d, struct wl_pointer *p, uint32_t t, wl_fixed_t x, wl_fixed_t y) { (void)d; (void)p; (void)t; (void)x; (void)y; }
static void ptr_button(void *d, struct wl_pointer *p, uint32_t serial, uint32_t t, uint32_t b, uint32_t st) { (void)d; (void)p; (void)serial; (void)t; (void)b; (void)st; }
static void ptr_axis(void *d, struct wl_pointer *p, uint32_t t, uint32_t a, wl_fixed_t v) { (void)d; (void)p; (void)t; (void)a; (void)v; }
static const struct wl_pointer_listener ptr_l = { .enter = ptr_enter, .leave = ptr_leave, .motion = ptr_motion, .button = ptr_button, .axis = ptr_axis };
static void seat_caps(void *d, struct wl_seat *st, uint32_t caps) {
  (void)d;
  if ((caps & WL_SEAT_CAPABILITY_POINTER) && !ptr) { ptr = wl_seat_get_pointer(st); wl_pointer_add_listener(ptr, &ptr_l, NULL); }
}
static void seat_name(void *d, struct wl_seat *st, const char *n) { (void)d; (void)st; (void)n; }
static const struct wl_seat_listener seat_l = { seat_caps, seat_name };

static void reg_global(void *d, struct wl_registry *r, uint32_t id, const char *iface, uint32_t ver) {
  (void)d;
  if (!strcmp(iface, "wl_compositor")) comp = wl_registry_bind(r, id, &wl_compositor_interface, ver < 4 ? ver : 4);
  else if (!strcmp(iface, "wl_shm")) shm = wl_registry_bind(r, id, &wl_shm_interface, 1);
  else if (!strcmp(iface, "xdg_wm_base")) { wm = wl_registry_bind(r, id, &xdg_wm_base_interface, ver < 2 ? ver : 2); xdg_wm_base_add_listener(wm, &wm_l, NULL); }
  else if (!strcmp(iface, "wl_seat") && !seat) { seat = wl_registry_bind(r, id, &wl_seat_interface, ver < 5 ? ver : 5); wl_seat_add_listener(seat, &seat_l, NULL); }
  else if (!strcmp(iface, "wl_output") && nout < MAX_OUT) {
    struct output *o = &outs[nout];
    memset(o, 0, sizeof *o);
    o->name_id = id;
    snprintf(o->name, sizeof o->name, "WL-%d", nout + 1); /* replaced by wl_output v4 "name" when the compositor sends it */
    o->wl = wl_registry_bind(r, id, &wl_output_interface, ver < 4 ? ver : 4);
    wl_output_add_listener(o->wl, &out_l, o);
    nout++;
  }
}
static void reg_remove(void *d, struct wl_registry *r, uint32_t id) {
  (void)d; (void)r;
  for (int i = 0; i < nout; i++) if (outs[i].name_id == id) { outs[i].w = outs[i].h = 0; }
}
static const struct wl_registry_listener reg_l = { reg_global, reg_remove };

/* ---- window of one client ---- */
static void buf_release(void *d, struct wl_buffer *b) {
  (void)b;
  *(int *)d = 0;
}
static const struct wl_buffer_listener buf_l = { buf_release };

static void client_free_bufs(struct client *c) {
  for (int i = 0; i < NBUF; i++) {
    if (c->bufs[i].wl) wl_buffer_destroy(c->bufs[i].wl);
    if (c->bufs[i].map) munmap(c->bufs[i].map, c->size);
    memset(&c->bufs[i], 0, sizeof c->bufs[i]);
  }
}

static int client_make_bufs(struct client *c) {
  c->stride = c->cw * 4;
  c->size = (size_t)c->stride * c->ch;
  int fd = memfd_create("odjezdy-wl", MFD_CLOEXEC);
  if (fd < 0 || ftruncate(fd, c->size * NBUF)) { if (fd >= 0) close(fd); return -1; }
  uint8_t *base = mmap(NULL, c->size * NBUF, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  if (base == MAP_FAILED) { close(fd); return -1; }
  struct wl_shm_pool *pool = wl_shm_create_pool(shm, fd, c->size * NBUF);
  close(fd);
  for (int i = 0; i < NBUF; i++) {
    c->bufs[i].map = base + i * c->size;
    c->bufs[i].wl = wl_shm_pool_create_buffer(pool, i * c->size, c->cw, c->ch, c->stride, WL_SHM_FORMAT_XRGB8888);
    wl_buffer_add_listener(c->bufs[i].wl, &buf_l, &c->bufs[i].busy);
  }
  wl_shm_pool_destroy(pool); /* the mapping and the buffers stay valid */
  c->back = 0; c->shown = -1;
  free(c->scratch);
  c->scratch = malloc(c->size);
  return c->scratch ? 0 : -1;
}

static void reply(struct client *c, const char *s) { ssize_t r = write(c->fd, s, strlen(s)); (void)r; }

static void client_drop(struct client *c) {
  if (c->top) xdg_toplevel_destroy(c->top);
  if (c->xs) xdg_surface_destroy(c->xs);
  if (c->surf) wl_surface_destroy(c->surf);
  client_free_bufs(c);
  free(c->scratch);
  close(c->fd);
  memset(c, 0, sizeof *c);
  c->fd = -1;
}

static void top_configure(void *d, struct xdg_toplevel *t, int32_t w, int32_t h, struct wl_array *st) {
  (void)t; (void)st;
  struct client *c = d;
  if (w > 0 && h > 0) {
    if (c->state == ST_FRAMES && (w != c->cw || h != c->ch)) c->closed = 1; /* resized under us: the client asks again */
    c->cw = w; c->ch = h;
  }
}
static void top_close(void *d, struct xdg_toplevel *t) { (void)t; ((struct client *)d)->closed = 1; }
static const struct xdg_toplevel_listener top_l = { top_configure, top_close, NULL, NULL };

static void xs_configure(void *d, struct xdg_surface *xs, uint32_t serial) {
  struct client *c = d;
  xdg_surface_ack_configure(xs, serial);
  c->configured = 1;
}
static const struct xdg_surface_listener xs_l = { xs_configure };

static void frame_done(void *d, struct wl_callback *cb, uint32_t t);
static const struct wl_callback_listener frame_l = { frame_done };

static void commit_buf(struct client *c, int i) {
  struct wl_callback *cb = wl_surface_frame(c->surf);
  wl_callback_add_listener(cb, &frame_l, c);
  c->cb_pending = 1;
  c->bufs[i].busy = 1;
  wl_surface_attach(c->surf, c->bufs[i].wl, 0, 0);
  wl_surface_damage_buffer(c->surf, 0, 0, c->cw, c->ch);
  wl_surface_commit(c->surf);
  c->shown = i;
}

static void frame_done(void *d, struct wl_callback *cb, uint32_t t) {
  (void)t;
  struct client *c = d;
  wl_callback_destroy(cb);
  c->cb_pending = 0;
  if (c->dirty && c->state == ST_FRAMES) { c->dirty = 0; commit_buf(c, c->back); c->back = -1; }
}

/* a buffer neither on screen nor waiting for the compositor, for the next frame */
static int pick_back(struct client *c) {
  for (int i = 0; i < NBUF; i++) if (i != c->shown && !c->bufs[i].busy) return i;
  return -1;
}

static void client_open_out(struct client *c, int n) {
  if (n < 0 || n >= nout || !outs[n].wl) { reply(c, "ERR no such output\n"); return; }
  if (!comp || !wm || !shm) { reply(c, "ERR compositor lacks wl_compositor/xdg_shell/wl_shm\n"); return; }
  c->out = n;
  c->surf = wl_compositor_create_surface(comp);
  c->xs = xdg_wm_base_get_xdg_surface(wm, c->surf);
  xdg_surface_add_listener(c->xs, &xs_l, c);
  c->top = xdg_surface_get_toplevel(c->xs);
  xdg_toplevel_add_listener(c->top, &top_l, c);
  xdg_toplevel_set_app_id(c->top, "online.odjezdy.board");
  xdg_toplevel_set_title(c->top, "Odjezdy");
  xdg_toplevel_set_fullscreen(c->top, outs[n].wl);
  wl_surface_commit(c->surf);
  c->state = ST_WAITCFG;
}

/* first configure arrived: size is known, make the buffers, answer the client, show a black frame */
static void client_ready(struct client *c) {
  if (c->cw <= 0 || c->ch <= 0) { c->cw = outs[c->out].w; c->ch = outs[c->out].h; }
  char buf[64];
  if (c->cw <= 0 || c->ch <= 0 || client_make_bufs(c)) { reply(c, "ERR cannot create window\n"); client_drop(c); return; }
  for (int i = 0; i < NBUF; i++) memset(c->bufs[i].map, 0, c->size);
  c->state = ST_FRAMES; c->got = 0;
  snprintf(buf, sizeof buf, "OK %d %d %d\n", c->cw, c->ch, c->stride);
  reply(c, buf);
  commit_buf(c, 0);
  c->back = pick_back(c);
}

static void client_line(struct client *c, char *line) {
  char buf[128];
  if (!strcmp(line, "LIST")) {
    for (int i = 0; i < nout; i++) {
      if (!outs[i].wl || outs[i].w <= 0) continue;
      snprintf(buf, sizeof buf, "OUT %d %d %d %d %s\n", i, outs[i].w, outs[i].h, outs[i].w * 4, outs[i].name);
      reply(c, buf);
    }
    reply(c, "END\n");
  } else if (!strncmp(line, "OUT ", 4)) client_open_out(c, atoi(line + 4));
  else reply(c, "ERR unknown command\n");
}

static void client_read(struct client *c) {
  if (c->state == ST_CMD) {
    ssize_t r = read(c->fd, c->line + c->llen, sizeof c->line - 1 - c->llen);
    if (r <= 0) { client_drop(c); return; }
    c->llen += r;
    c->line[c->llen] = 0;
    char *nl;
    while (c->state == ST_CMD && (nl = strchr(c->line, '\n'))) {
      *nl = 0;
      client_line(c, c->line);
      size_t rest = c->llen - (nl + 1 - c->line);
      memmove(c->line, nl + 1, rest);
      c->llen = rest;
      c->line[c->llen] = 0;
    }
    if (c->fd >= 0 && c->llen >= sizeof c->line - 1) client_drop(c);
    return;
  }
  uint64_t frame = c->size;
  if (c->back < 0) c->back = pick_back(c);
  uint8_t *dst = c->back >= 0 ? c->bufs[c->back].map : c->scratch;   /* no free buffer: this frame is dropped */
  ssize_t r = read(c->fd, dst + c->got, frame - c->got);
  if (r <= 0) { client_drop(c); return; }
  c->got += r;
  if (c->got < frame) return;
  c->got = 0;
  if (c->back < 0) return;
  if (c->cb_pending) c->dirty = 1;               /* newest frame waits in c->back for the compositor's next frame callback */
  else { commit_buf(c, c->back); c->back = -1; }
}

static volatile sig_atomic_t quit;
static void on_signal(int s) { (void)s; quit = 1; }

int main(int argc, char **argv) {
  char defsock[256];
  const char *rt = getenv("XDG_RUNTIME_DIR");
  snprintf(defsock, sizeof defsock, "%s/odjezdy-wl.sock", rt && *rt ? rt : "/tmp");
  const char *sock = argc > 1 ? argv[1] : getenv("ODJEZDY_WL_SOCK") ? getenv("ODJEZDY_WL_SOCK") : defsock;
  signal(SIGINT, on_signal); signal(SIGTERM, on_signal); signal(SIGPIPE, SIG_IGN);
  for (int i = 0; i < MAX_CLIENT; i++) clients[i].fd = -1;

  dpy = wl_display_connect(NULL);
  if (!dpy) { fprintf(stderr, "odjezdy-wl: no Wayland compositor (WAYLAND_DISPLAY)\n"); return 1; }
  struct wl_registry *reg = wl_display_get_registry(dpy);
  wl_registry_add_listener(reg, &reg_l, NULL);
  wl_display_roundtrip(dpy);
  wl_display_roundtrip(dpy); /* output modes and names */
  if (!comp || !shm || !wm) { fprintf(stderr, "odjezdy-wl: compositor lacks wl_compositor, wl_shm or xdg_wm_base\n"); return 1; }
  for (int i = 0; i < nout; i++) fprintf(stderr, "odjezdy-wl: %s %dx%d\n", outs[i].name, outs[i].w, outs[i].h);

  int ls = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  struct sockaddr_un sa = { .sun_family = AF_UNIX };
  snprintf(sa.sun_path, sizeof sa.sun_path, "%s", sock);
  unlink(sock);
  if (ls < 0 || bind(ls, (struct sockaddr *)&sa, sizeof sa) || listen(ls, 8)) { perror("odjezdy-wl: socket"); return 1; }
  chmod(sock, 0600);
  printf("READY %d\n", nout); /* the board waits for this line */
  fflush(stdout);

  while (!quit) {
    while (wl_display_prepare_read(dpy) != 0) wl_display_dispatch_pending(dpy);
    if (wl_display_flush(dpy) < 0 && errno != EAGAIN) { wl_display_cancel_read(dpy); break; }
    struct pollfd p[MAX_CLIENT + 2];
    int map[MAX_CLIENT + 2], np = 0;
    p[np].fd = wl_display_get_fd(dpy); p[np].events = POLLIN; map[np++] = -2;
    p[np].fd = ls; p[np].events = POLLIN; map[np++] = -1;
    for (int i = 0; i < MAX_CLIENT; i++)
      if (clients[i].fd >= 0 && clients[i].state != ST_WAITCFG) { p[np].fd = clients[i].fd; p[np].events = POLLIN; map[np++] = i; }
    int pr = poll(p, np, 500);
    if (pr > 0 && (p[0].revents & POLLIN)) wl_display_read_events(dpy); else wl_display_cancel_read(dpy);
    if (pr > 0 && (p[0].revents & (POLLERR | POLLHUP))) break;
    if (wl_display_dispatch_pending(dpy) < 0) break;

    for (int i = 0; i < MAX_CLIENT; i++) {
      struct client *c = &clients[i];
      if (c->fd < 0) continue;
      if (c->closed) { client_drop(c); continue; }
      if (c->state == ST_WAITCFG && c->configured) client_ready(c);
    }
    if (pr <= 0) continue;
    for (int k = 1; k < np; k++) {
      if (!(p[k].revents & (POLLIN | POLLHUP | POLLERR))) continue;
      if (map[k] == -1) {
        int fd = accept4(ls, NULL, NULL, SOCK_CLOEXEC);
        if (fd < 0) continue;
        int slot = -1;
        for (int i = 0; i < MAX_CLIENT; i++) if (clients[i].fd < 0) { slot = i; break; }
        if (slot < 0) { close(fd); continue; }
        memset(&clients[slot], 0, sizeof clients[slot]);
        clients[slot].fd = fd; clients[slot].out = -1; clients[slot].state = ST_CMD; clients[slot].shown = -1;
      } else if (clients[map[k]].fd >= 0) client_read(&clients[map[k]]);
    }
  }
  for (int i = 0; i < MAX_CLIENT; i++) if (clients[i].fd >= 0) client_drop(&clients[i]);
  wl_display_disconnect(dpy);
  unlink(sock);
  return quit ? 0 : 1;   /* a lost compositor is an error so the service restarts us */
}
