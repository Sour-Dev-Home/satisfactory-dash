## [2026-10-27] docs | ADR-0055: clarifications from building merge and split

ADR-0055's 2026-10-27 amendment gains "Clarifications" from building PR 3 (#727). A split that leaves unconnected
parts still gives one factory per side, because the reduction keys a designated factory by its id. A merge needs the
picked factories to be connected by themselves. An older backend gets no merge or split, with no PUT/DELETE fallback.
Undo lasts as long as the toast.
