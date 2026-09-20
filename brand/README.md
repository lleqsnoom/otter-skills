# Otter PM brand

The mark's sources, kept beside the app rather than in it: nothing here is bundled, imported or published, so the
app carries no image it does not draw.

| File | What it is |
|------|------------|
| `otter.eps` | the source artwork, as exported from the original illustration (EPS with an embedded TIFF) |
| `otter-logo.svg` | the traced drawing, filled |
| `otter-logo-line.svg` | the same drawing as a line |
| `trace.svg` | the first trace, before the border and the page tint were added |
| `proposals/prop_01…prop_10.png` | the ten refined propositions, and nothing has been chosen among them yet |

**The app's icon is `public/favicon.svg`, and it is `otter.eps` traced**: the artwork's outline at 50% alpha,
filled a warm brown, `#8b5a2b`, and `#d9a978` in a dark scheme. Recut it rather than draw it, with

    magick otter.eps -alpha extract -threshold 50% -negate -depth 8 -compress none otter-mask.pgm
    potrace -s -o favicon.svg --turdsize 20 --alphamax 1.0 --opttolerance 0.2 otter-mask.pgm

then replace potrace's `fill="#000000"` with `path { fill: #231f20 }` and its dark-scheme rule in the head.
`Shell.astro` links that one file and nothing else, so choosing a proposition is still a file copy.

The wordmark in the rail is text (`Otter PM` in `src/components/App.tsx`), so the app needs no image to be
readable and a drawing that changes later cannot break a screen.