- 2026-10-27 — Planner: removed "Reason factories for me" and its suggestion mode (the owner's decision). The overview no
  longer draws automatic factories dashed with a "Suggestion" tag and a Keep pill, on the canvas or the cards, and the
  Keep form path is gone (`SuggestionControls`, `KeepForm`, `CanvasSuggestions`, `suggestionTag` and their tests, the
  `planner-suggestions` state and baselines). Automatic factories are still shown, plainly; designating groups, merge,
  split, pop-out, dissolve and undo are unchanged. ADR-0061's "Group into a new factory" will designate automatic
  factories later.
