import math, sys
INK="#23263A"; CAR="#B9733F"; CREAM="#FFE6C7"; TEAL="#14B8A6"; SUN="#FFC53D"; CORAL="#FF6B5B"; GRAPE="#7C5CFF"
C = 128            # ring centre
RO, RI = 105, 67   # ring outer / inner radius (same as original: r86 ± 19)
SEGS = [(-135, CORAL), (-45, SUN), (45, TEAL), (135, GRAPE)]

def pt(r, a):
    return C + r*math.cos(math.radians(a)), C + r*math.sin(math.radians(a))

def ring():
    out = []
    for a, col in SEGS:
        (x1,y1),(x2,y2),(x3,y3),(x4,y4) = pt(RO,a), pt(RO,a+90), pt(RI,a+90), pt(RI,a)
        out.append(f'<path fill="{col}" d="M{x1:.2f} {y1:.2f}A{RO} {RO} 0 0 1 {x2:.2f} {y2:.2f}L{x3:.2f} {y3:.2f}A{RI} {RI} 0 0 0 {x4:.2f} {y4:.2f}Z"/>')
    return "\n".join(out)

def head_path(cx, cy, a, ht, hb, kt=0.5523, kb=0.5523):
    """Head from four anchors; kt/kb > 0.5523 square off the top/bottom (0.5523 = true ellipse)."""
    return (f"M{cx} {cy-ht}"
            f"C{cx+kt*a:.2f} {cy-ht} {cx+a} {cy-kt*ht:.2f} {cx+a} {cy}"
            f"C{cx+a} {cy+kb*hb:.2f} {cx+kb*a:.2f} {cy+hb} {cx} {cy+hb}"
            f"C{cx-kb*a:.2f} {cy+hb} {cx-a} {cy+kb*hb:.2f} {cx-a} {cy}"
            f"C{cx-a} {cy-kt*ht:.2f} {cx-kt*a:.2f} {cy-ht} {cx} {cy-ht}Z")

def bez(p0,p1,p2,p3,t):
    u=1-t; return tuple(u**3*p0[i]+3*u*u*t*p1[i]+3*u*t*t*p2[i]+t**3*p3[i] for i in (0,1))

def head_points(cx, cy, a, ht, hb, kt, kb, n=400):
    segs = [((cx,cy-ht),(cx+kt*a,cy-ht),(cx+a,cy-kt*ht),(cx+a,cy)),
            ((cx+a,cy),(cx+a,cy+kb*hb),(cx+kb*a,cy+hb),(cx,cy+hb)),
            ((cx,cy+hb),(cx-kb*a,cy+hb),(cx-a,cy+kb*hb),(cx-a,cy)),
            ((cx-a,cy),(cx-a,cy-kt*ht),(cx-kt*a,cy-ht),(cx,cy-ht))]
    return [bez(*s, i/n) for s in segs for i in range(n)]

def gap(points):
    """Smallest distance between the head contour and the ring's inner edge (negative = overlap)."""
    return min(RI - math.hypot(x-C, y-C) for x, y in points)

def circle(x, y, r, f): return f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{r}" fill="{f}"/>'
def ell(x, y, rx, ry, f): return f'<ellipse cx="{x:.2f}" cy="{y:.2f}" rx="{rx}" ry="{ry}" fill="{f}"/>'

def nose(x, y, w=23, h=15):
    """Otter nose: a wide, softly rounded inverted triangle."""
    l, r, t, b = x-w/2, x+w/2, y-h*0.45, y+h*0.55
    return (f'<path fill="{INK}" d="M{x} {t-1.5:.2f}C{r-3:.2f} {t-1.5:.2f} {r+1:.2f} {t:.2f} {r:.2f} {t+3:.2f}'
            f'C{r-1:.2f} {t+6:.2f} {x+5:.2f} {b-1:.2f} {x} {b:.2f}C{x-5:.2f} {b-1:.2f} {l+1:.2f} {t+6:.2f} {l:.2f} {t+3:.2f}'
            f'C{l-1:.2f} {t:.2f} {l+3:.2f} {t-1.5:.2f} {x} {t-1.5:.2f}Z"/>')

def paw(x, y, toes=False, col=CAR):
    if not toes:
        return circle(x, y, 12, col)
    # palm plus three toe bumps curling over the rim
    return "\n".join([ell(x, y-1, 12, 10.5, col)] + [circle(x+dx, y+8, 4.6, col) for dx in (-7, 0, 7)])

def otter(p):
    cx, cy, a, ht, hb = 128, p["cy"], p["a"], p["ht"], p["hb"]
    kt, kb = p.get("kt", 0.5523), p.get("kb", 0.5523)
    g = gap(head_points(cx, cy, a, ht, hb, kt, kb))
    ex, ey, er = p["eye_dx"], cy + p["eye_dy"], p["eye_r"]
    mx, my = p["muz_dx"], cy + p["muz_dy"]
    ears_y, ears_dx, ear_r = cy + p["ear_dy"], p["ear_dx"], p["ear_r"]
    parts = [
        circle(cx-ears_dx, ears_y, ear_r, CAR), circle(cx+ears_dx, ears_y, ear_r, CAR),
        circle(cx-ears_dx-1.5, ears_y-0.5, ear_r*0.45, INK), circle(cx+ears_dx+1.5, ears_y-0.5, ear_r*0.45, INK),
        f'<path fill="{CAR}" d="{head_path(cx, cy, a, ht, hb, kt, kb)}"/>',
        circle(cx-ex, ey, er, INK), circle(cx+ex, ey, er, INK),
        circle(cx-ex+er*0.4, ey-er*0.38, er*0.36, "#fff"), circle(cx+ex+er*0.4, ey-er*0.38, er*0.36, "#fff"),
        ell(cx-mx, my, p["muz_rx"], p["muz_ry"], CREAM), ell(cx+mx, my, p["muz_rx"], p["muz_ry"], CREAM),
    ]
    if p.get("whiskers"):
        for s in (-1, 1):
            for dx, dy in ((7, -1), (12, 4), (5, 6)):
                parts.append(circle(cx + s*(mx+dx) - s*8, my + dy - 1, 1.7, CAR))
    parts.append(nose(cx, cy + p["nose_dy"]) if p.get("otter_nose") else ell(cx, cy + p["nose_dy"], 10.5, 6.8, INK))
    parts += [paw(cx - p["paw_dx"], p["paw_y"], p.get("toes")), paw(cx + p["paw_dx"], p["paw_y"], p.get("toes"))]
    return "\n".join(parts), g

def svg(title, body, w=256):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} 256" width="{w}" height="256" role="img"><title>{title}</title>\n{body}\n</svg>\n'

BASE = dict(cy=155, a=62, ht=44, hb=48, eye_dx=23.5, eye_dy=-11, eye_r=6.5,
            muz_dx=13, muz_dy=17, muz_rx=16.7, muz_ry=14.6, nose_dy=5,
            ear_dx=53, ear_dy=-24, ear_r=9, paw_dx=24, paw_y=207)
VARIANTS = {
    "r1": ("Refined",      dict(BASE)),
    "r2": ("Otter",        dict(BASE, otter_nose=True, whiskers=True)),
    "r3": ("Otter bun",    dict(BASE, otter_nose=True, whiskers=True, kt=0.6, ht=42)),
}
if __name__ == "__main__":
    for k, (t, p) in VARIANTS.items():
        body, g = otter(p)
        open(f"{k}-symbol.svg", "w").write(svg(f"Otter Skills — {t}", ring() + "\n" + body))
        print(f"{k}: head-to-ring gap {g:.1f}")

def lockup(body):
    return svg("Otter Skills lockup", body +
        f'\n<text x="284" y="150" font-family="Inter Display" font-weight="800" font-size="104" fill="{INK}" letter-spacing="-3">otter</text>'
        f'\n<text x="288" y="214" font-family="Inter Display" font-weight="600" font-size="56" fill="{INK}" letter-spacing="1">skills</text>', 760)

if __name__ == "__main__":
    for k, (t, p) in VARIANTS.items():
        open(f"{k}-lockup.svg", "w").write(lockup(ring() + "\n" + otter(p)[0]))
