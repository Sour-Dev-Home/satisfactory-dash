- 2026-10-26 — ADR-0055 PR 10b, designations on the Planner canvas.
  - Owners and admins get a Select mode on an opened factory's canvas (a toolbar button, or Shift+drag). A freehand
    lasso picks the cards whose centre it encloses (`graph/lasso.ts`); in Select mode a click or a card's hidden
    button picks one card.
  - The picks are the same selection as 10a's table ticks, with one "Designate selected" bar for both views, and
    Escape clears them.
  - "Reason factories for me" now draws its suggestions on the overview canvas (dashed, a "Suggestion" tag and a
    Keep pill opening the shared `KeepForm`) instead of switching to the cards.
  - Members see the suggestions without Keep and get no Select mode; Shift+drag pans for them. The owner chose a
    freehand lasso over a rectangle.
