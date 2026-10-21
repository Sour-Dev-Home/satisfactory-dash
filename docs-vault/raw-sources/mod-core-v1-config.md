# The core mod's config file and keys (captured 2026-10-21)

Source: the sibling `satisfactory-dash-mod` repository, `docs/specs/2026-10-20-core-mod-v1-design.md`, at commit `5701529`
(lines 58 and 110, quoted exactly below). Captured 2026-10-21 for the self-serve UI (#529, ADR-0046), which tells players where to
paste an enrolment code. Immutable: if the mod's spec changes, add a new dated file.

## Line 58, the `Config` part of the mod

```
| `Config` | Reads `FactoryGame/Configs/SatisDashAgent.cfg`: `backendUrl` (default `https://api.satis-manager.com`) and `enrollmentCode` | `store.json` |
```

## Line 110, first boot with no config

```
| Missing config (first boot) | Writes `SatisDashAgent.cfg` with the default URL and an empty code, then idles. The game runs normally | One log line: add an enrolment code from the dashboard |
```

## Note on code length

At this capture the same spec (the contract section, an enrol bullet) still states the old 8-character code format
`^[A-Z2-7]{4}-[A-Z2-7]{4}$`. ADR-0046 section 4 (#524) moves codes to 12 characters (`XXXX-XXXX-XXXX`); the mod changes with it.
The dashboard's wording says 12 characters.
