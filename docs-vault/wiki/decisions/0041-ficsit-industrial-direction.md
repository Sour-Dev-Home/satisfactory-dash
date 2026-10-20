# ADR-0041: The FICSIT-industrial visual direction

Status: accepted (owner, 2026-10-19) for #441, from a mock-up of the overview and the map. It
supersedes ADR-0016's direction B2 (energy monitor and status page, the pick under ADR-0016 item 7);
the rest of ADR-0016 (Tailwind tokens, the strict CSP, visual validation) stands.

## Context
- **The current look reads as a template.** GitHub-dark greys, a sky-blue accent and a blue square
  for a logo: nothing on screen says Satisfactory.
- **The case study already has a look.** The owner's portfolio case study for this project uses a
  "FICSIT steel" palette. Matching it makes the product and its case study read as one thing.
- **Constraints that don't change.**
  - The CSP is `font-src 'self'` (`frontend/public/_headers`), so fonts are self-hosted, never
    loaded from a font CDN.
  - Every colour is a token in `frontend/src/index.css`'s `@theme` block, and the token lint
    refuses raw values elsewhere (ADR-0016 item 2).
  - Every text/background pair keeps WCAG AA; the e2e suite's axe check fails on any contrast
    violation (ADR-0016 item 5).

## Decision

### 1. Palette
| Role | Token | Value |
| --- | --- | --- |
| Canvas | `--color-canvas` | #17191c |
| Surface | `--color-surface` | #1f2226 |
| Surface 2 | `--color-surface-2` | #2b3035 |
| Line | `--color-line` | #353b41 |
| Strong line | (no token yet; added when a component needs it) | #545c64 |
| Ink | `--color-fg` | #ece7dc |
| Strong ink | `--color-fg-strong` | #fbf8f2 |
| Muted | `--color-muted` | #a3a9ae |
| Accent (FICSIT amber) | `--color-accent` | #fa9549 |
| On accent | `--color-on-accent` | #1b1b1b |
| Status ok | `--color-ok` | #6fd49a |
| Status warn | `--color-warn` | #e9c46a |
| Status bad | `--color-bad` | #ef5350 |
| Status info ("paused") | `--color-info` | #9cc0e2 |

The token names are unchanged; only their values moved. The soft, solid, edge and on-soft variants
are recomputed from these colours so every pair keeps AA: white on each `-solid` is at least 4.5:1,
each `-on-soft` is at least 4.5:1 on its tint over every surface, and on-accent on amber is about
8:1. One limit: `bad` text is AA on the canvas and the surface but 3.8:1 on surface-2, so red text
on surface-2 or on a red tint uses `bad-on-soft`.

### 2. Colour rules
- **Red only for failure** (an outage, a tripped fuse, an error).
- **Blue only for "paused".**
- **Amber is the accent and power, never a status.** A warning is the warn yellow, not amber.

### 3. Type
- **Barlow Condensed** (600, 700) for headings, card titles, labels such as table headers, and the
  tabs: uppercase with letter-spacing. Token `--font-display`.
- **Barlow** (400, 500, 600) for text. Token `--font-sans`, with the system stack after it.
- Both are self-hosted woff2 files in `frontend/public/fonts/`, latin subset and only those weights,
  with `font-display: swap`. Each family falls back first to a local Arial face adjusted to its
  measured width and vertical metrics (`size-adjust` and the overrides), so text doesn't jump when
  the font arrives. Their SIL Open Font License sits beside them (`OFL.txt`) and in the repository's
  third-party notices.

### 4. Accents
A **hazard stripe** under the header and **corner rivets** on panels. They're decorative only and
never carry meaning: nothing is told apart by a stripe or a rivet.

### 5. Icons
Station icons (server rack, power, factory, machine) drawn like the case-study figures in the
owner's portfolio.

### 6. Motion
Each animation means something real: power flowing on a live circuit, a backed-up machine pulsing.
None is decoration. Reduced motion turns each one off through the existing motion tokens (the
`prefers-reduced-motion` block at the end of `@layer base` sets every duration to 0).

### 7. Build order (each its own task)
1. This ADR, the tokens and the fonts (#441).
2. The overview.
3. The map (outside the Leaflet section #434 owns).
4. The landing page.

## Consequences
- Every visual baseline changes with the tokens and the fonts; they're regenerated in CI's Linux
  image, as ADR-0016 says.
- The fonts add about 105 KB of woff2 across five files, fetched only for the weights a page uses.
- The ui-reviewer judges UI PRs against this direction from now on, not B2.
- Components keep their token utilities; restyling them (stripe, rivets, icons, motion) is the
  follow-up tasks' work, not this one's.

## Revisit when
- A light theme is wanted: the palette is dark only.
- A designer's file exists (ADR-0016 item 7 then makes it the source of truth).
- Text outside the latin subset needs to render (the fonts would need latin-ext).
