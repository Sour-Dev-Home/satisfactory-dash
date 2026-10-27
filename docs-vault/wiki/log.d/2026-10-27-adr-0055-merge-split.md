## [2026-10-27] docs | ADR-0055 amendment: merge and split factories

Decided how the planner merges connected factories and takes them apart again (#727): one transactional
`POST …/planner/designations/replace` serves merge, split, pop-out, dissolve and undo, guarded by a per-designation
`revision` (409 `designation_stale`); connectivity is checked in the client; undo is a client-held inverse request that
keeps ids and creation order. Three build PRs follow: contract, backend, frontend.
