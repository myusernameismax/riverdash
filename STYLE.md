# Flow Tides style rules

How the app should look and read. Follow these when changing anything on screen.
Colors and timing values live in `js/config.js`; theme colors in `css/app.css` (`:root`).

## Shapes and surfaces

- **No borders or outlines.** Nothing gets a 1px edge: not tiles, buttons, chips,
  text fields or selected items. Separate things with spacing and soft tinted
  backgrounds (`var(--tint)`, or `color-mix(… 8–22%, transparent)`).
- **Selected = a stronger tint of its own color**, no outline. The picked data tile
  is its accent at ~22%, the weather day the reading bar is on is light blue, the
  jetty / surf day is orange.
- **Text fields:** a gray tint at rest, a light blue tint while typing. No outline.
- **Rows in a list** are separated by hairlines only *between* rows (`var(--hair)`),
  never boxed. Exception: in Edit, a group is a light blue tinted box (still no
  outline) so it's clear what's inside it.
- Rounded corners everywhere (`var(--radius)` for boxes).
- In the Linux panel popup, the page background is see-through so Plasma's own
  rounded frame is the background. Don't add a frame of our own.

## Icons and marks

- Simple, iOS-like symbols. No Android-style filled circles around symbols:
  deleting a place is a plain red trash can (ungrouping a plain red minus), not a red circle.
- Stars are solid: yellow for the ★ place, gray for the others. No outline stars.
- Arrows after readings: ↑ rising, ↓ falling, → steady.
- One signal per state: an on/off chip is shown by its tint alone, no ✓ added.
- Tappable text is blue (`var(--link)`): Edit, + Group, Done, Cancel, station names, and the
  list button that opens the Places list. A button that
  belongs to a chart takes that tab's accent instead (View History). A small ↗ marks only
  links that leave the app (the map). No colored pins or emoji-like icons.
- Pick from presets, don't type values (history ranges are chips, not dates).

## Motion and timing

- Notes with **Undo** stay up 3.5 s; other notes 4.5 s (`js/config.js`).
- Swipes copy iOS: clearly sideways before anything moves, rubber-band resistance
  past the end (UIScrollView curve, c = 0.55), destructive full swipes need a long drag.
- Going between a place and the Places list zooms (like Apple Weather); pages on top
  (Add, Share) slide in from the right.
- Nothing is rigid. Every scrolling page or list can be pushed and springs back (iOS's
  rubber band, or our own stiff ones), even when everything fits on screen.
- Nothing jumps. Panels (Customize) glide the page first, then unfold / switch;
  closing glides back, then folds. Things loading keep their spot (a spinning tile
  sits where the real one will be). Pull-to-refresh and the end-of-page pull use
  the same rubber band (the same give everywhere) and spring back. The place header
  glides to a new height (another place, the wind line), and things above the
  keyboard (the Add button) ride up and down with it.
- Reordering copies Apple Weather: hold a place (350 ms) or drag Edit's ≡; rows swap
  once the carried one's leading edge reaches their middle, the passed rows slide aside,
  and the carried one stays under the finger until it's let go. Held over a closed group
  for 600 ms, the group opens (and closes again when passed).
  With a mouse, a held place (not a group) can also go in the red trash can box that rises at the bottom:
  over it, the place shrinks into the box and the box fills red; carried out, it pops back.

## Words

- **No text that explains the UI**: no "tap to…", legends describing the screen or
  banners. Short labels only ("Tide · ft"). Explanations go in the README.
  Exception: the history chart has a one-line legend (Recorded Flow / Average Flow),
  because its two lines are easy to mix up.
  Also the splash screen's one tip per start ("Tip: Add a tide station to a river with" + the
  sliders symbol), shown only when the start is slow enough to read it.
  Also the Share page: "Include your settings in the link" in a tinted box with its switch
  beside it and a count under them, and the Import button has
  one gray line under it saying what importing does, because not everyone sharing is
  comfortable with apps.
- Data in tooltips and labels is fine ("Forecast · measured 8 h ago").
- Plain words over jargon ("Typical flow", not "median").

## Color meaning

- **Dark for now**: the app is always dark (`data-theme="dark"` on `<html>` in index.html), whatever
  the device is set to. The light colors are still in app.css; the Linux panel still follows Plasma.

- Each kind of reading has one accent: height blue, flow teal, water temp pink, tide
  purple, waves orange (`js/config.js`).
- Status: green = in shape / calm, yellow = caution, red = out of shape / sketchy,
  gray = no range set.
- Deleting (Edit's trash can, a group's −, the swipe's Delete, the drag's trash can box) is iOS's bright red
  (`--remove`); errors and Customize's Remove keep the softer `--negative`.
- Charts: the reading under the bar is a rounded chip tinted with the chart's accent (~18%),
  no outline and no solid backing (the lines under it are cleared, so the page shows through).
- Charts: solid line = measured, dashed = forecast. A good range colors the line
  only (green inside, red outside), never a shaded band.
