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
  never boxed.
- Rounded corners everywhere (`var(--radius)` for boxes).
- In the Linux panel popup, the page background is see-through so Plasma's own
  rounded frame is the background. Don't add a frame of our own.

## Icons and marks

- Simple, iOS-like symbols. No Android-style filled circles around symbols:
  remove is a plain red minus, not a red circle.
- Stars are solid: yellow for the ★ place, gray for the others. No outline stars.
- Arrows after readings: ↑ rising, ↓ falling, → steady.

## Words

- **No text that explains the UI**: no "tap to…", legends describing the screen or
  banners. Short labels only ("Tide · ft"). Explanations go in the README.
- Data in tooltips and labels is fine ("Forecast · measured 8 h ago").
- Plain words over jargon ("Typical flow", not "median").

## Color meaning

- Each kind of reading has one accent: height blue, flow teal, water temp pink, tide
  purple, waves orange (`js/config.js`).
- Status: green = in shape / calm, yellow = caution, red = out of shape / sketchy,
  gray = no range set.
- Charts: solid line = measured, dashed = forecast. A good range colors the line
  only (green inside, red outside), never a shaded band.
