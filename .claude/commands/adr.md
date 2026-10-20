---
description: Architecture review of an issue or PR; records the decision as an ADR
argument-hint: <issue-or-pr-number | idea text>
---
The argument is either an issue or PR number, or free idea text: $ARGUMENTS

**An issue or PR number.** Spawn the architecture-advisor agent as a fresh subagent on #$ARGUMENTS (`gh issue view`
or `gh pr view`, and the files they link). It decides with evidence. Record the decision as
`NNNN-<slug>.md` in `docs-vault/wiki/decisions/`, numbered with the next free number there, in the format of the
recent ADRs (Status, Context, Decision, Consequences, Revisit when), add a row to that folder's README table, and
link it from #$ARGUMENTS. If the decision changes an interface, the ADR names the contract file.

**Idea text.** Spawn the architecture-advisor agent as a fresh subagent on the idea text and the files it touches. It
decides with evidence. Write the full ADR in the same format, with `Status: proposed` until the owner accepts it,
the next free number, and a list of the files the implementing work will change.
