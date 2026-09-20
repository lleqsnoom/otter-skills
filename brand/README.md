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

**The app's icon is `public/favicon.svg`, and it is a placeholder**: a copy of `otter-logo-line.svg`, which is a
portrait drawing on its own page tint rather than a square mark. Replacing it is a file copy — pick a proposition,
or export a square mark, and put it at `public/favicon.svg`. `Shell.astro` links that one file and nothing else.

The wordmark in the rail is text (`Otter PM` in `src/components/App.tsx`), so the app needs no image to be
readable and a drawing that changes later cannot break a screen.