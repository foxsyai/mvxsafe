# The mvxsafe mark

The FoxLeague fox head, hollow, with a check inside: a safe that several people guard.
One path for the head, one for the check, so it scales to any size and stays sharp.

Orange is `#FF6E0A`, ink `#09090D`, chalk `#F5F5F5`.

| File | Use |
|---|---|
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
