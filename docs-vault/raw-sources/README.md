# raw-sources

Drop immutable source material here. Never hand-edit a file once it's in this folder —
if something changes upstream, add a new file (e.g. `frm-getFactory-response-2.json`)
rather than overwriting. (One deliberate exception, #343: the third-party page copies below
were trimmed to excerpts once, 2026-09-27.)

Priorities, in order:

1. **`dedicated-server-api.md`** — excerpts of `CommunityResources/DedicatedServerAPIDocs.md`
   from a Satisfactory dedicated server install. This is the official vanilla HTTPS API
   reference (single POST endpoint, `{"function": "Name", "data": {...}}`); the full file ships
   with every install.
2. **`frm-read-api.md`** — excerpts of the FicsitRemoteMonitoring "API (Read)" index:
   https://docs.ficsit.app/ficsitremotemonitoring/latest/json/Read/Read.html (and one
   `frm-<endpoint>.md` per endpoint page this repo uses).
3. **`frm-dedicated-server.md`** — excerpts of:
   https://docs.ficsit.app/ficsitremotemonitoring/latest/dedicatedserver.html
4. **Captured responses** — once FRM is installed on a test server, save a real JSON
   response from each endpoint you plan to use (`frm-getFactory-sample.json`,
   `frm-getPlayer-sample.json`, etc.). Real samples catch shape mismatches that prose
   docs miss.
5. Anything else you find useful: SML docs, Discord/forum answers, GitHub issues.
   Note the source URL and date at the top of each file.
6. Third-party docs without a licence permitting redistribution: capture the pinned URL plus quoted excerpts, not whole pages.

## Excerpt files, and how to cite them

A third-party page is kept as its source (URL or install path), capture date, and only the
excerpts this repo cites, verbatim, each under a numbered heading: `### E3 — <what it covers>`.

- **Cite an excerpt by its ID, never by line number:** `dedicated-server-api.md` E5, or
  `frm-getFactory.md` E3. Line numbers break when a file is trimmed or an excerpt is added.
  `npm run test:scripts` fails on a `<file>.md:<line>` citation to an excerpt file anywhere
  outside the frozen wiki log.
- **Need something that isn't excerpted yet?** Quote it as a new excerpt with the next free
  number at the end of the file. Never renumber or reword an existing excerpt; citations
  depend on them.
- Full copies of the 2026-09-21 captures are kept outside the repo, and git history has them.
