/*
 * odjezdy-kms: drives every connected monitor of one GPU through DRM/KMS for Odjezdy OS boards.
 *
 * The kernel's fbdev emulation (/dev/fb0) only shows one output, so for multi-monitor setups this helper
 * becomes DRM master, gives each connected connector its preferred mode and a dumb buffer, and lets board
 * processes stream raw frames over a unix socket:
 *
 *   client: "LIST\n"     -> "OUT <n> <w> <h> <stride> <connector-name>\n" ... "END\n"
 *   client: "OUT <n>\n"  -> "OK <w> <h> <stride>\n" (or "ERR <msg>\n"),
 *                           then the client sends frames of stride*h bytes (XRGB8888) back to back.
 *
 * While another VT is active (Alt+F2 service console) the DRM device is closed completely so the kernel
 * console gets the screen back; frames received meanwhile are discarded. Coming back re-runs the modeset.
 *
 * Build: cc -O2 -Wall -o odjezdy-kms odjezdy-kms.c $(pkg-config --cflags --libs libdrm)
 * Run:   odjezdy-kms [/run/odjezdy-kms.sock] [vt-name, default tty1]
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
#include <time.h>
#include <unistd.h>
#include <xf86drm.h>
#include <xf86drmMode.h>

#define MAX_OUT 8
#define MAX_CLIENT 16

struct output {
  uint32_t conn, crtc, fb, handle;
  drmModeModeInfo mode;
  uint32_t w, h, stride;
  uint64_t size;
  uint8_t *map;
  char name[32];
};

struct client {
  int fd, out;           /* out = -1 until "OUT n" */
  char line[64];
  size_t llen;
  uint64_t got;          /* bytes of the current frame received */
  uint8_t *scratch;      /* frame data lands here while the VT is inactive */
};

static struct output outs[MAX_OUT];
static int nout, drm = -1;
static struct client clients[MAX_CLIENT];
static const char *own_vt = "tty1";

static const char *conn_type(uint32_t t) {
  switch (t) {
    case DRM_MODE_CONNECTOR_HDMIA: return "HDMI";
    case DRM_MODE_CONNECTOR_DisplayPort: return "DP";
    case DRM_MODE_CONNECTOR_eDP: return "eDP";
    case DRM_MODE_CONNECTOR_VGA: return "VGA";
    case DRM_MODE_CONNECTOR_DVII: case DRM_MODE_CONNECTOR_DVID: return "DVI";
    case DRM_MODE_CONNECTOR_LVDS: return "LVDS";
    case DRM_MODE_CONNECTOR_VIRTUAL: return "Virtual";
    default: return "Unknown";
  }
}

static int vt_active(void) {
  char buf[32] = {0};
  int fd = open("/sys/class/tty/tty0/active", O_RDONLY);
  if (fd < 0) return 1;
  ssize_t n = read(fd, buf, sizeof buf - 1);
  close(fd);
  if (n <= 0) return 1;
  buf[strcspn(buf, "\n")] = 0;
  return strcmp(buf, own_vt) == 0;
}

static void drm_close(void) {
  for (int i = 0; i < nout; i++) {
    struct output *o = &outs[i];
    if (o->map) munmap(o->map, o->size);
    if (o->fb) drmModeRmFB(drm, o->fb);
    if (o->handle) { struct drm_mode_destroy_dumb d = { .handle = o->handle }; drmIoctl(drm, DRM_IOCTL_MODE_DESTROY_DUMB, &d); }
    o->map = NULL; o->fb = o->handle = 0;
  }
  if (drm >= 0) close(drm);
  drm = -1;
}

/* open the first card with connected outputs, modeset every connected connector */
static int drm_open(void) {
  char path[32];
  for (int card = 0; card < 4; card++) {
    snprintf(path, sizeof path, "/dev/dri/card%d", card);
    int fd = open(path, O_RDWR | O_CLOEXEC);
    if (fd < 0) continue;
    uint64_t dumb = 0;
    drmModeRes *res = drmModeGetResources(fd);
    if (!res || drmGetCap(fd, DRM_CAP_DUMB_BUFFER, &dumb) || !dumb) { if (res) drmModeFreeResources(res); close(fd); continue; }
    int n = 0;
    uint32_t used_crtcs = 0;
    for (int c = 0; c < res->count_connectors && n < MAX_OUT; c++) {
      drmModeConnector *con = drmModeGetConnector(fd, res->connectors[c]);
      if (!con) continue;
      if (con->connection != DRM_MODE_CONNECTED || con->count_modes == 0) { drmModeFreeConnector(con); continue; }
      /* preferred mode, else the first (largest) */
      drmModeModeInfo mode = con->modes[0];
      for (int m = 0; m < con->count_modes; m++) if (con->modes[m].type & DRM_MODE_TYPE_PREFERRED) { mode = con->modes[m]; break; }
      /* a CRTC this connector can use and nobody else took */
      int crtc = -1;
      for (int e = 0; e < con->count_encoders && crtc < 0; e++) {
        drmModeEncoder *enc = drmModeGetEncoder(fd, con->encoders[e]);
        if (!enc) continue;
        for (int k = 0; k < res->count_crtcs; k++)
          if ((enc->possible_crtcs & (1u << k)) && !(used_crtcs & (1u << k))) { crtc = k; break; }
        drmModeFreeEncoder(enc);
      }
      if (crtc < 0) { drmModeFreeConnector(con); continue; }
      struct output *o = &outs[n];
      memset(o, 0, sizeof *o);
      o->conn = con->connector_id; o->crtc = res->crtcs[crtc]; o->mode = mode;
      o->w = mode.hdisplay; o->h = mode.vdisplay;
      snprintf(o->name, sizeof o->name, "%s-%u", conn_type(con->connector_type), con->connector_type_id);
      struct drm_mode_create_dumb cd = { .width = o->w, .height = o->h, .bpp = 32 };
      if (drmIoctl(fd, DRM_IOCTL_MODE_CREATE_DUMB, &cd)) { drmModeFreeConnector(con); continue; }
      o->handle = cd.handle; o->stride = cd.pitch; o->size = cd.size;
      if (drmModeAddFB(fd, o->w, o->h, 24, 32, o->stride, o->handle, &o->fb)) { drmModeFreeConnector(con); continue; }
      struct drm_mode_map_dumb md = { .handle = o->handle };
      if (drmIoctl(fd, DRM_IOCTL_MODE_MAP_DUMB, &md)) { drmModeFreeConnector(con); continue; }
      o->map = mmap(0, o->size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, md.offset);
      if (o->map == MAP_FAILED) { o->map = NULL; drmModeFreeConnector(con); continue; }
      memset(o->map, 0, o->size);
      if (drmModeSetCrtc(fd, o->crtc, o->fb, 0, 0, &o->conn, 1, &o->mode)) {
        fprintf(stderr, "odjezdy-kms: setcrtc %s: %s\n", o->name, strerror(errno));
      }
      drmModeDirtyFB(fd, o->fb, NULL, 0);
      used_crtcs |= 1u << crtc;
      n++;
      drmModeFreeConnector(con);
    }
    drmModeFreeResources(res);
    if (n > 0) {
      drm = fd; nout = n;
      for (int i = 0; i < n; i++) fprintf(stderr, "odjezdy-kms: %s %ux%u on %s\n", outs[i].name, outs[i].w, outs[i].h, path);
      return 0;
    }
    close(fd);
  }
  return -1;
}

static void client_drop(struct client *c) {
  close(c->fd);
  free(c->scratch);
  memset(c, 0, sizeof *c);
  c->fd = -1;
}

static void reply(struct client *c, const char *s) {
  ssize_t r = write(c->fd, s, strlen(s));
  (void)r;
}

static void client_line(struct client *c, char *line) {
  char buf[128];
  if (!strcmp(line, "LIST")) {
    for (int i = 0; i < nout; i++) {
      snprintf(buf, sizeof buf, "OUT %d %u %u %u %s\n", i, outs[i].w, outs[i].h, outs[i].stride, outs[i].name);
      reply(c, buf);
    }
    reply(c, "END\n");
  } else if (!strncmp(line, "OUT ", 4)) {
    int n = atoi(line + 4);
    if (n < 0 || n >= nout) { reply(c, "ERR no such output\n"); return; }
    c->out = n; c->got = 0;
    c->scratch = realloc(c->scratch, outs[n].size);
    snprintf(buf, sizeof buf, "OK %u %u %u\n", outs[n].w, outs[n].h, outs[n].stride);
    reply(c, buf);
  } else reply(c, "ERR unknown command\n");
}

static void client_read(struct client *c, int active) {
  if (c->out < 0) { /* command mode: read one line */
    ssize_t r = read(c->fd, c->line + c->llen, sizeof c->line - 1 - c->llen);
    if (r <= 0) { client_drop(c); return; }
    c->llen += r;
    c->line[c->llen] = 0;
    char *nl;
    while ((nl = strchr(c->line, '\n'))) {
      *nl = 0;
      client_line(c, c->line);
      size_t rest = c->llen - (nl + 1 - c->line);
      memmove(c->line, nl + 1, rest);
      c->llen = rest;
      c->line[c->llen] = 0;
      if (c->out >= 0) break;
    }
    if (c->llen >= sizeof c->line - 1) client_drop(c);
    return;
  }
  /* frame mode: straight into the scanout buffer (or scratch while another VT owns the screen) */
  struct output *o = &outs[c->out];
  uint64_t frame = (uint64_t)o->stride * o->h;
  uint8_t *dst = (active && o->map) ? o->map : c->scratch;
  ssize_t r = read(c->fd, dst + c->got, frame - c->got);
  if (r <= 0) { client_drop(c); return; }
  c->got += r;
  if (c->got >= frame) {
    c->got = 0;
    /* virtual / USB GPUs (virtio-gpu, qxl, udl, …) only show a dumb buffer after a dirty notice;
       real GPUs scan it out directly and return ENOSYS, which is fine */
    if (active && o->fb) drmModeDirtyFB(drm, o->fb, NULL, 0);
  }
}

static volatile sig_atomic_t quit;
static void on_signal(int s) { (void)s; quit = 1; }

int main(int argc, char **argv) {
  const char *sock = argc > 1 ? argv[1] : "/run/odjezdy-kms.sock";
  if (argc > 2) own_vt = argv[2];
  signal(SIGINT, on_signal); signal(SIGTERM, on_signal); signal(SIGPIPE, SIG_IGN);
  for (int i = 0; i < MAX_CLIENT; i++) clients[i].fd = -1;

  int active = vt_active();
  if (active && drm_open()) { fprintf(stderr, "odjezdy-kms: no usable DRM output\n"); return 1; }

  int ls = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  struct sockaddr_un sa = { .sun_family = AF_UNIX };
  strncpy(sa.sun_path, sock, sizeof sa.sun_path - 1);
  unlink(sock);
  if (ls < 0 || bind(ls, (struct sockaddr *)&sa, sizeof sa) || listen(ls, 8)) { perror("odjezdy-kms: socket"); return 1; }
  chmod(sock, 0600);
  printf("READY %d\n", nout); /* the board waits for this line */
  fflush(stdout);

  while (!quit) {
    struct pollfd p[MAX_CLIENT + 1];
    int map[MAX_CLIENT + 1], np = 0;
    p[np].fd = ls; p[np].events = POLLIN; map[np++] = -1;
    for (int i = 0; i < MAX_CLIENT; i++) if (clients[i].fd >= 0) { p[np].fd = clients[i].fd; p[np].events = POLLIN; map[np++] = i; }
    poll(p, np, 300);

    /* VT switch: give the screen back to the kernel console, take it again on return */
    int now = vt_active();
    if (now != active) {
      if (!now) { drm_close(); fprintf(stderr, "odjezdy-kms: VT left, DRM released\n"); }
      else if (drm_open()) fprintf(stderr, "odjezdy-kms: VT back but no DRM output\n");
      active = now;
    }

    for (int k = 0; k < np; k++) {
      if (!(p[k].revents & (POLLIN | POLLHUP | POLLERR))) continue;
      if (map[k] < 0) {
        int fd = accept4(ls, NULL, NULL, SOCK_CLOEXEC);
        if (fd < 0) continue;
        int slot = -1;
        for (int i = 0; i < MAX_CLIENT; i++) if (clients[i].fd < 0) { slot = i; break; }
        if (slot < 0) { close(fd); continue; }
        memset(&clients[slot], 0, sizeof clients[slot]);
        clients[slot].fd = fd; clients[slot].out = -1;
      } else client_read(&clients[map[k]], active && drm >= 0);
    }
  }
  drm_close();
  unlink(sock);
  return 0;
}
