# Architecture diagrams

D2 sources with their rendered SVGs. They show what the [ADRs](../decisions/README.md)
decided; when a diagram and an ADR disagree, the ADR wins and the diagram is stale.

| Diagram | Shows | ADRs it reflects |
|---|---|---|
| [`01-context.d2`](./01-context.d2) ([svg](./satisfactory-dash-01-context.svg)) | System context as deployed today | 0011, 0013, 0014 |
| [`02-deployed.d2`](./02-deployed.d2) ([svg](./satisfactory-dash-02-deployed.svg)) | Deployed containers: Cloudflare edge, tunnel, backend, game API, FRM | 0013, 0019, 0022 |
| [`03-backend-modules.d2`](./03-backend-modules.d2) ([svg](./satisfactory-dash-03-backend-modules.svg)) | Backend modules and their dependency rules | 0014 |
| [`04-target.d2`](./04-target.d2) ([svg](./satisfactory-dash-04-target.svg)) | Planned multi-user architecture (not built yet) | 0014, 0017, 0020, 0021 |

## Source of truth

[`../../workspace.dsl`](../../workspace.dsl) is the source of truth for the architecture
(ADR-0024). The D2 files here are presentation-only (ADR-0024 item 5).

## Keeping them current

A PR that changes something a diagram shows (topology, module edges) updates the `.d2`
file and re-renders the SVG in the same PR.

## Re-rendering

Use D2 v0.9.0:

```sh
d2 --layout dagre --theme 0 --dark-theme 200 --pad 40 <in>.d2 <out>.svg
```
