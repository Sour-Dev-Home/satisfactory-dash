## [2026-10-27] feat | Planner: merge and split factories (ADR-0055 #727, build PR 3)

The frontend for ADR-0055 Decisions 11 and 12. Owners and admins pick factories on the overview (Shift- or Ctrl-click on
the canvas, or the cards' Select ticks) and merge them into one; Merge stays disabled with "These factories are not
connected by any belt, pipe or transport" when the picked factories are not one connected piece by themselves
(`planner/connectivity.ts`), and names the cap otherwise. Inside a designated factory, "Split into a new factory" splits
the picked groups (by the backend's `memberBuildingIds`; unmatched members stay), a row's or the group panel's "Pop out"
splits one group under its own name, and Remove becomes Dissolve. Every change goes through
`plannerDesignations.replace` (`planner/designationOps.ts` builds the requests; `designationChanges.ts` runs them) and is
offered back for about 10 seconds in a non-modal toast ("Split back" after a merge, "Undo" otherwise) that waits while
focused or hovered; the undo restores the read pre-image (ids, `createdAt`, member order). A `designation_stale` answer
re-reads, drops the selection and says "Changed by someone else; select again". Without `revision` (an older backend)
none of this is offered and the old Remove and Designate selected stay. The demo now keeps designations in memory and
applies them to its graph, so the whole flow works there; new scenarios and an e2e keyboard path (merge, then Split back)
cover it.
