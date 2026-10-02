"""Build the Otter Skills logo kit from the approved concept C geometry (refine.py, variant r2).

Needs skia-pathops, uharfbuzz and Inter Variable (see ../README.md §8):  python kit.py <out-dir>
"""
import math, os, sys
import pathops
import uharfbuzz as hb
from refine import VARIANTS, INK, CAR, CREAM, TEAL, SUN, CORAL, GRAPE, SEGS

OUT = sys.argv[1] if len(sys.argv) > 1 else "kit"
os.makedirs(OUT, exist_ok=True)
WHITE, BLACK = "#FFFFFF", "#000000"
K = 0.5523  # cubic handle factor for a quarter circle
FONT = "/usr/share/fonts/inter/InterVariable.ttf"


# ---------- geometry as pathops paths ----------

def _arc(pen, cx, cy, r, a0, a1, move=False):
    n = max(1, math.ceil(abs(a1 - a0) / 90))
    th = math.radians((a1 - a0) / n)
    k = 4 / 3 * math.tan(th / 4)
    a = math.radians(a0)
    p = lambda t: (cx + r * math.cos(t), cy + r * math.sin(t))
    if move:
        pen.moveTo(p(a))
    for _ in range(n):
        b = a + th
        (x0, y0), (x3, y3) = p(a), p(b)
        pen.curveTo((x0 - k * r * math.sin(a), y0 + k * r * math.cos(a)),
                    (x3 + k * r * math.sin(b), y3 - k * r * math.cos(b)), (x3, y3))
        a = b


def sector(cx, cy, ro, ri, a0, a1):
    path = pathops.Path(); pen = path.getPen()
    _arc(pen, cx, cy, ro, a0, a1, move=True)
    pen.lineTo((cx + ri * math.cos(math.radians(a1)), cy + ri * math.sin(math.radians(a1))))
    _arc(pen, cx, cy, ri, a1, a0)
    pen.closePath()
    return path


def oval(cx, cy, a, ht, hb_=None, kt=K, kb=K):
    """Ellipse-like shape from four anchors; ht/hb = height above/below the centre."""
    hb_ = ht if hb_ is None else hb_
    path = pathops.Path(); pen = path.getPen()
    pen.moveTo((cx, cy - ht))
    pen.curveTo((cx + kt * a, cy - ht), (cx + a, cy - kt * ht), (cx + a, cy))
    pen.curveTo((cx + a, cy + kb * hb_), (cx + kb * a, cy + hb_), (cx, cy + hb_))
    pen.curveTo((cx - kb * a, cy + hb_), (cx - a, cy + kb * hb_), (cx - a, cy))
    pen.curveTo((cx - a, cy - kt * ht), (cx - kt * a, cy - ht), (cx, cy - ht))
    pen.closePath()
    return path


def circle(cx, cy, r):
    return oval(cx, cy, r, r)


def nose_path(x, y, w=23, h=15):
    l, r, t, b = x - w / 2, x + w / 2, y - h * 0.45, y + h * 0.55
    path = pathops.Path(); pen = path.getPen()
    pen.moveTo((x, t - 1.5))
    pen.curveTo((r - 3, t - 1.5), (r + 1, t), (r, t + 3))
    pen.curveTo((r - 1, t + 6), (x + 5, b - 1), (x, b))
    pen.curveTo((x - 5, b - 1), (l + 1, t + 6), (l, t + 3))
    pen.curveTo((l - 1, t), (l + 3, t - 1.5), (x, t - 1.5))
    pen.closePath()
    return path


def U(*ps):
    out = pathops.Path()
    for p in ps:
        out = pathops.op(out, p, pathops.PathOp.UNION)
    return out


def D(a, *bs):
    for b in bs:
        a = pathops.op(a, b, pathops.PathOp.DIFFERENCE)
    return a


def d_attr(path):
    out = []
    f = lambda pt: f"{pt[0]:.2f} {pt[1]:.2f}".replace(".00", "")
    for verb, pts in path.segments:
        if verb == "moveTo": out.append("M" + f(pts[0]))
        elif verb == "lineTo": out.append("L" + f(pts[0]))
        elif verb == "curveTo": out.append("C" + " ".join(f(p) for p in pts))
        elif verb == "qCurveTo":
            # TrueType-style run: on-curve points between consecutive controls are implied midpoints
            ctrls, end = pts[:-1], pts[-1]
            for i, c in enumerate(ctrls):
                nxt = end if i == len(ctrls) - 1 else ((c[0] + ctrls[i + 1][0]) / 2, (c[1] + ctrls[i + 1][1]) / 2)
                out.append("Q" + f(c) + " " + f(nxt))
        elif verb in ("closePath", "endPath"): out.append("Z")
    return "".join(out)


# ---------- the mark ----------

def mark(p, ring=(128, 128, 105, 67), detail=True):
    """Return the mark as named pathops layers, from the same parameters as refine.py."""
    rc, rc2, RO, RI = ring
    cx, cy = 128, p["cy"]
    head = oval(cx, cy, p["a"], p["ht"], p["hb"], p.get("kt", K), p.get("kb", K))
    ey, ex, er = cy + p["ear_dy"], p["ear_dx"], p["ear_r"]
    ears = [circle(cx - ex, ey, er), circle(cx + ex, ey, er)]
    paws = [circle(cx - p["paw_dx"], p["paw_y"], p.get("paw_r", 12)), circle(cx + p["paw_dx"], p["paw_y"], p.get("paw_r", 12))]
    eyes = [circle(cx - p["eye_dx"], cy + p["eye_dy"], p["eye_r"]), circle(cx + p["eye_dx"], cy + p["eye_dy"], p["eye_r"])]
    my = cy + p["muz_dy"]
    muzzle = U(oval(cx - p["muz_dx"], my, p["muz_rx"], p["muz_ry"]), oval(cx + p["muz_dx"], my, p["muz_rx"], p["muz_ry"]))
    nose = nose_path(cx, cy + p["nose_dy"], p.get("nose_w", 23), p.get("nose_h", 15))
    L = {"ring": [sector(rc, rc2, RO, RI, a, a + 90) for a, _ in SEGS],
         "body": U(head, *ears, *paws), "head": head, "paws": paws, "muzzle": muzzle, "nose": nose, "eyes": eyes}
    ink = U(*eyes, nose)
    if detail:
        inner = [circle(cx - ex - 1.5, ey - 0.5, er * 0.45), circle(cx + ex + 1.5, ey - 0.5, er * 0.45)]
        L["inner_ears"] = D(U(*inner), head)
        ink = U(ink, L["inner_ears"])
        er_ = p["eye_r"]
        L["shine"] = U(*[circle(cx + s * p["eye_dx"] + er_ * 0.4, cy + p["eye_dy"] - er_ * 0.38, er_ * 0.36) for s in (-1, 1)])
        L["whiskers"] = U(*[circle(cx + s * (p["muz_dx"] + dx) - s * 8, my + dy - 1, 1.7)
                             for s in (-1, 1) for dx, dy in ((7, -1), (12, 4), (5, 6))])
    L["ink"] = ink
    return L


def colour_svg_body(L):
    out = [f'<g id="ring">'] + [f'<path fill="{c}" d="{d_attr(s)}"/>' for s, (_, c) in zip(L["ring"], SEGS)] + ['</g>', '<g id="otter">',
           f'<path fill="{CAR}" d="{d_attr(L["body"])}"/>', f'<path fill="{CREAM}" d="{d_attr(L["muzzle"])}"/>']
    if "whiskers" in L: out.append(f'<path fill="{CAR}" d="{d_attr(L["whiskers"])}"/>')
    out.append(f'<path fill="{INK}" d="{d_attr(L["ink"])}"/>')
    if "shine" in L: out.append(f'<path fill="{WHITE}" d="{d_attr(L["shine"])}"/>')
    out.append('</g>')
    return "\n".join(out)


def mono_path(L, p, gap=5, seam=4):
    """One-colour mark: real cut-outs instead of white paint, so it works on any background."""
    cx, cy = 128, p["cy"]
    halo = U(oval(cx, cy, p["a"] + gap, p["ht"] + gap, p["hb"] + gap, p.get("kt", K), p.get("kb", K)),
             *[circle(cx + s * p["paw_dx"], p["paw_y"], p.get("paw_r", 12) + gap) for s in (-1, 1)])
    ring = D(U(*L["ring"]), halo)
    for a, _ in SEGS:  # thin seams keep the four lifebuoy segments readable in one colour
        t = math.radians(a); nx, ny = -math.sin(t) * seam / 2, math.cos(t) * seam / 2
        x0, y0, x1, y1 = 128 + 60 * math.cos(t), 128 + 60 * math.sin(t), 128 + 112 * math.cos(t), 128 + 112 * math.sin(t)
        cut = pathops.Path(); pen = cut.getPen()
        pen.moveTo((x0 + nx, y0 + ny)); pen.lineTo((x1 + nx, y1 + ny)); pen.lineTo((x1 - nx, y1 - ny)); pen.lineTo((x0 - nx, y0 - ny)); pen.closePath()
        ring = D(ring, cut)
    nose_halo = nose_path(cx, cy + p["nose_dy"], p.get("nose_w", 23) + 7, p.get("nose_h", 15) + 6)
    face = D(L["body"], *L["eyes"], L["muzzle"], nose_halo, *( [L["inner_ears"]] if "inner_ears" in L else []))
    pupils = U(*[circle(cx + s * p["eye_dx"] + 1.2, cy + p["eye_dy"] - 1.2, p["eye_r"] * 0.5) for s in (-1, 1)])
    return U(ring, face, L["nose"], pupils)


def svg(w, h, body, title="Otter Skills logo", vb=None):
    vb = vb or f"0 0 {w:g} {h:g}"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{w:g}" height="{h:g}" role="img" aria-labelledby="t">'
            f'<title id="t">{title}</title>\n{body}\n</svg>\n')


def write(name, content):
    with open(os.path.join(OUT, name), "w") as f:
        f.write(content)
    print("wrote", name)


# ---------- wordmark ----------

class _Pen:
    def __init__(self, path, sx, ox, oy):
        self.p, self.s, self.ox, self.oy = path.getPen(), sx, ox, oy
    def _t(self, pt): return (self.ox + pt[0] * self.s, self.oy - pt[1] * self.s)
    def moveTo(self, pt): self.p.moveTo(self._t(pt))
    def lineTo(self, pt): self.p.lineTo(self._t(pt))
    def curveTo(self, *pts): self.p.curveTo(*[self._t(q) for q in pts])
    def qCurveTo(self, *pts): self.p.qCurveTo(*[self._t(q) for q in pts])
    def closePath(self): self.p.closePath()
    def endPath(self): self.p.closePath()


_blob = hb.Blob.from_file_path(FONT)
_face = hb.Face(_blob)


def set_line(text, size, wght, tracking=0.0, x=0.0, baseline=0.0):
    """Shape and outline one line of text. Returns (body path, i-dot paths, advance width). tracking in em."""
    font = hb.Font(_face)
    font.set_variations({"wght": wght, "opsz": 32})
    upem = _face.upem
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": True})
    s = size / upem
    body, dots, pen_x = pathops.Path(), [], x
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        g = pathops.Path()
        font.draw_glyph_with_pen(info.codepoint, _Pen(g, s, pen_x + pos.x_offset * s, baseline - pos.y_offset * s))
        ch = text[info.cluster]
        if ch == "i":  # split off the tittle so it can become a round brand-coloured dot
            contours = list(g.contours)
            top = min(contours, key=lambda c: c.bounds[1])
            for c in contours:
                if c is not top: body = U(body, c)
            x0, y0, x1, y1 = top.bounds
            r = (x1 - x0) / 2 * 1.06  # a circle reads smaller than a square of the same width
            dots.append(circle((x0 + x1) / 2, (y0 + y1) / 2 - r * 0.04, r))
        else:
            body = U(body, g)
        pen_x += pos.x_advance * s + tracking * size
    return body, dots, pen_x - tracking * size - x


def bounds(path):
    return path.bounds  # (xmin, ymin, xmax, ymax)


# ---------- build ----------

P = dict(VARIANTS["r2"][1])          # approved concept C
L = mark(P)
mono = mono_path(L, P)

# small-size cut: thicker ring, bigger head and features, no fine detail
PS = dict(cy=150, a=70, ht=50, hb=58, eye_dx=28, eye_dy=-12, eye_r=11, muz_dx=15, muz_dy=28, muz_rx=24, muz_ry=19,
          nose_dy=10, nose_w=36, nose_h=24, ear_dx=53, ear_dy=-32, ear_r=12, paw_dx=30, paw_y=212, paw_r=15)
LS = mark(PS, ring=(128, 128, 122, 72), detail=False)

symbol_colour = colour_svg_body(L)
write("otter-skills-symbol.svg", svg(256, 256, symbol_colour))
write("otter-skills-symbol-small.svg", svg(256, 256, colour_svg_body(LS), "Otter Skills logo (small sizes)"))
for name, col in (("black", BLACK), ("white", WHITE), ("ink", INK)):
    write(f"otter-skills-symbol-{name}.svg", svg(256, 256, f'<path fill="{col}" d="{d_attr(mono)}"/>'))

# Lockups work on the ring's tight box: the ring spans 23..233 in the symbol, so translate by -23.
RING_D = 210
def place_symbol(body, x, y, scale=1.0):
    return f'<g transform="translate({x - 23 * scale:.2f} {y - 23 * scale:.2f}) scale({scale:g})">\n{body}\n</g>'

def name_block(two_line, dark, mono_col=None, size=104):
    """'otter' heavy + 'skills' lighter. Returns (svg, xmin, ymin, xmax, ymax) at origin baseline 0."""
    w1, w2 = (762, 572) if dark else (800, 600)   # reversed type is thinned ~5% against irradiation
    text_col = mono_col or (WHITE if dark else INK)
    dot_col = mono_col or CORAL
    if two_line:
        a, _, _ = set_line("otter", size, w1, tracking=-0.03)
        sz2 = size * 0.54
        ax0 = bounds(a)[0]
        b, dots, _ = set_line("skills", sz2, w2, tracking=0.018)
        bx0 = bounds(b)[0]
        # optical left alignment: the round 'o' overshoots, so it sits a hair left of the 's'
        a_shift, b_shift = -ax0 - size * 0.012, -bx0
        b_base = size * 0.2 + (-bounds(b)[1])  # gap below 'otter' baseline = 0.2 × size, measured to the top of 'k'/'l'
        a = transform(a, a_shift, 0); b = transform(b, b_shift, b_base); dots = [transform(d, b_shift, b_base) for d in dots]
    else:
        a, _, adv = set_line("otter", size, w1, tracking=-0.03)
        b, dots, _ = set_line("skills", size, w2, tracking=0.0, x=adv + size * 0.26)
    body = U(a, b)
    allp = U(body, *dots)
    x0, y0, x1, y1 = bounds(allp)
    out = f'<path fill="{text_col}" d="{d_attr(body)}"/>' + "".join(f'<path fill="{dot_col}" d="{d_attr(d)}"/>' for d in dots)
    return out, x0, y0, x1, y1


def transform(path, dx, dy):
    out = pathops.Path(); pen = out.getPen()
    class T:
        def moveTo(s, p): pen.moveTo((p[0] + dx, p[1] + dy))
        def lineTo(s, p): pen.lineTo((p[0] + dx, p[1] + dy))
        def curveTo(s, *ps): pen.curveTo(*[(q[0] + dx, q[1] + dy) for q in ps])
        def qCurveTo(s, *ps): pen.qCurveTo(*[(q[0] + dx, q[1] + dy) for q in ps])
        def closePath(s): pen.closePath()
        def endPath(s): pen.closePath()
    path.draw(T())
    return out


def horizontal(dark=False, mono_col=None):
    sym = f'<path fill="{mono_col}" d="{d_attr(mono)}"/>' if mono_col else symbol_colour
    text, x0, y0, x1, y1 = name_block(True, dark, mono_col)
    gap = 48                                   # 1.25 × the ring band (38)
    cy_text = (y0 + y1) / 2
    ty = RING_D / 2 - cy_text - RING_D * 0.012  # centre on the ring, nudged up for the optical centre
    tx = RING_D + gap - x0
    W = RING_D + gap + (x1 - x0)
    body = place_symbol(sym, 0, 0) + f'\n<g transform="translate({tx:.2f} {ty:.2f})">{text}</g>'
    return svg(round(W, 1), RING_D, body)


def stacked(dark=False, mono_col=None):
    sym = f'<path fill="{mono_col}" d="{d_attr(mono)}"/>' if mono_col else symbol_colour
    text, x0, y0, x1, y1 = name_block(False, dark, mono_col, size=60)
    tw, th = x1 - x0, y1 - y0
    W = max(RING_D, tw)
    gap = RING_D * 0.16
    body = place_symbol(sym, (W - RING_D) / 2, 0) + f'\n<g transform="translate({(W - tw) / 2 - x0:.2f} {RING_D + gap - y0:.2f})">{text}</g>'
    return svg(round(W, 1), round(RING_D + gap + th, 1), body)


def wordmark(dark=False, mono_col=None):
    text, x0, y0, x1, y1 = name_block(False, dark, mono_col, size=100)
    return svg(round(x1 - x0, 1), round(y1 - y0, 1), f'<g transform="translate({-x0:.2f} {-y0:.2f})">{text}</g>')


def banner(dark=False):
    """README header, 1280×320: the horizontal lockup on a soft field with a four-colour rule."""
    W, H = 1280, 320
    bg = "#1B1D2C" if dark else "#FFF8EF"
    text, x0, y0, x1, y1 = name_block(True, dark)
    s = 1.0
    lw = (RING_D + 48 + (x1 - x0)) * s
    lx, ly = (W - lw) / 2, (H - RING_D * s) / 2 - 6
    cy_text = (y0 + y1) / 2
    body = [f'<rect width="{W}" height="{H}" rx="24" fill="{bg}"/>',
            f'<g transform="translate({lx:.2f} {ly:.2f}) scale({s})">',
            place_symbol(symbol_colour, 0, 0),
            f'<g transform="translate({RING_D + 48 - x0:.2f} {RING_D / 2 - cy_text - RING_D * 0.012:.2f})">{text}</g></g>']
    seg = (W - 2 * 24) / 4
    for i, c in enumerate((CORAL, SUN, TEAL, GRAPE)):
        body.append(f'<rect x="{24 + i * seg:.1f}" y="{H - 14}" width="{seg:.1f}" height="6" fill="{c}"/>')
    return svg(W, H, "\n".join(body), "Otter Skills")


write("otter-skills-horizontal.svg", horizontal())
write("otter-skills-horizontal-on-dark.svg", horizontal(dark=True))
write("otter-skills-horizontal-black.svg", horizontal(mono_col=BLACK))
write("otter-skills-horizontal-white.svg", horizontal(dark=True, mono_col=WHITE))
write("otter-skills-stacked.svg", stacked())
write("otter-skills-stacked-on-dark.svg", stacked(dark=True))
write("otter-skills-wordmark.svg", wordmark())
write("otter-skills-wordmark-on-dark.svg", wordmark(dark=True))
write("otter-skills-banner.svg", banner())
write("otter-skills-banner-dark.svg", banner(dark=True))


def social():
    """GitHub social preview, 1280×640: the stacked lockup on cream with the four-colour rule."""
    W, H = 1280, 640
    text, x0, y0, x1, y1 = name_block(False, False, size=60)
    tw, th = x1 - x0, y1 - y0
    gap = RING_D * 0.16
    lw, lh = max(RING_D, tw), RING_D + gap + th
    s = 400 / lh
    ox, oy = (W - lw * s) / 2, (H - lh * s) / 2 - 10
    body = [f'<rect width="{W}" height="{H}" fill="#FFF8EF"/>',
            f'<g transform="translate({ox:.2f} {oy:.2f}) scale({s:.4f})">',
            place_symbol(symbol_colour, (lw - RING_D) / 2, 0),
            f'<g transform="translate({(lw - tw) / 2 - x0:.2f} {RING_D + gap - y0:.2f})">{text}</g></g>']
    seg = W / 4
    for i, c in enumerate((CORAL, SUN, TEAL, GRAPE)):
        body.append(f'<rect x="{i * seg:.1f}" y="{H - 16}" width="{seg:.1f}" height="16" fill="{c}"/>')
    return svg(W, H, "\n".join(body), "Otter Skills")


write("otter-skills-social.svg", social())
