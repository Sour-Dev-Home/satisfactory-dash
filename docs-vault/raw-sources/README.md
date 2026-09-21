# raw-sources

Drop immutable source material here. Never hand-edit a file once it's in this folder —
if something changes upstream, add a new file (e.g. `frm-getFactory-response-2.json`)
rather than overwriting.

Priorities, in order:

1. **`dedicated-server-api.md`** — copy the contents of
   `CommunityResources/DedicatedServerAPIDocs.md` from your Satisfactory dedicated
   server install directory. This is the official vanilla HTTPS API reference
   (single POST endpoint, `{"function": "Name", "data": {...}}`).
2. **`frm-read-api.md`** — save the FicsitRemoteMonitoring "API (Read)" docs:
   https://docs.ficsit.app/ficsitremotemonitoring/latest/json/Read/Read.html
3. **`frm-dedicated-server.md`** — save:
   https://docs.ficsit.app/ficsitremotemonitoring/latest/dedicatedserver.html
4. **Captured responses** — once FRM is installed on a test server, save a real JSON
   response from each endpoint you plan to use (`frm-getFactory-sample.json`,
   `frm-getPlayer-sample.json`, etc.). Real samples catch shape mismatches that prose
   docs miss.
5. Anything else you find useful: SML docs, Discord/forum answers, GitHub issues.
   Note the source URL and date at the top of each file.
