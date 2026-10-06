# The mvxsafe mark

The FoxLeague fox head, hollow, with a check inside: a safe that several people guard.
One path for the head, one for the check, so it scales to any size and stays sharp.

Orange is `#FF6E0A`, ink `#09090D`, chalk `#F5F5F5`.

**The mark in use since 6 October 2026 is `solid-ink-check.svg`**: the head filled in orange
with a thick black check. Black carries about three times the contrast of white on that orange,
which is what keeps it readable at 16 pixels. It is the favicon, the app icons, the header logo
and the header of the signer PDF. `solid-white-check.svg` is the same shape with a white check,
kept for large uses where the softer look is wanted.

| File | Use |
|---|---|
| `solid-ink-check.svg` | **The mark.** Filled orange head, thick black check. |
| `solid-white-check.svg` | The same with a white check, for large sizes only. |
| `mark-on-dark.svg` | Dark backgrounds. Orange head, white check. The app header uses this. |
| `mark-on-light.svg` | White or light backgrounds. Orange head, black check, because white vanishes there. |
| `mark-on-orange.svg` | On the brand orange. Black head, white check. |
| `mark-black.svg`, `mark-white.svg` | One colour, for print, stamps and photographs. |
| `tile-dark.svg` | The browser icon. A dark rounded tile, because a transparent mark loses its check on whichever tab colour it does not suit. |
| `tile-orange.svg` | Avatars and app stores, where a filled square reads better. |

`png/` holds each of them at 512, 192, 64, 32 and 16 pixels, with transparent background.

Chrome picks the SVG favicon when one is offered and does not re-evaluate
`prefers-color-scheme`, so a theme-aware favicon does not work there. That is why the
browser icon is a tile and not the transparent mark.

Regenerate the PNGs after editing an SVG: the small script in
`scratchpad/renderbrand.js` of the session that made them, or any SVG rasteriser.
