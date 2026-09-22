Captured: 2026-09-21, live server, GameVersion 1.2.4.0, CL 502094, FRM 1.5.3, SML 3.12.0
Method: POST https://localhost:7777/api/v1  body: {"function":"frm","endpoint":"getSessionInfo"}
(exactly as documented in frm-dedicated-server.md's tunneled Game Port API example)

---

{"errorCode":"bad_function","errorMessage":"Payload JSON function 'frm' not found"}
HTTP 404

The documented tunneled-transport function name ('frm') is not registered on this
server/version combination, despite FRM being loaded (confirmed via FactoryGame.log
showing FRM subsystems registered, and via the FRM Web Server working directly on
port 8080). The FRM Web Server (direct HTTP, not tunneled through 7777) is the
transport that actually works: GET http://<host>:8080/<endpointName>, no POST
envelope needed, no auth required in this local test (AllowInsecureLocalAccess=1
was set for the vanilla API; unclear whether that also disabled FRM's own auth
token check, or whether FRM simply didn't enforce it for localhost -- see
frm-config.md's uWS.AuthenticationToken field). [NEEDS VERIFICATION] whether the
tunneled 'frm' function was removed/renamed in FRM 1.5.x, or whether it requires
config not covered in frm-config.md.
