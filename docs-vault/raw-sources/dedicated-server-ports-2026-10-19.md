Source: https://satisfactory.wiki.gg/index.php?title=Dedicated_servers&oldid=62959 (revision 62959 of 2026-10-06T19:55:22Z, the current one on the capture date)
Captured: 2026-10-19T19:59:13Z
Method: the page's wikitext through MediaWiki's raw action (`https://satisfactory.wiki.gg/wiki/Dedicated_servers?action=raw`), the revision ID from the site's API (`api.php?action=query&prop=revisions`); passages copied unedited from the wikitext, so markup such as `<code>` and `[[links]]` appears as in the source.
Source kind: **community.** satisfactory.wiki.gg is a community-edited wiki, not Coffee Stain documentation. No official Coffee Stain source for the ports was found: a web search for one on 2026-10-19 returned only this wiki and hosting-provider guides, and the excerpts already captured from the install's own API document (`dedicated-server-api.md`) name no port number.
Excerpts only: The wiki's content licence is CC BY-NC-SA 4.0 (the site's `rightsinfo`). Its non-commercial and share-alike terms do not fit this AGPL-3.0-only repository with monetisation undecided, so only quoted excerpts are kept, with this attribution; the full page stays at the pinned URL.
Item: ADR-0039 G0 addendum (#452): which ports the dedicated server listens on, and the arguments or config that move them (the G2 harness).
FINDINGS (as the wiki states them):
  - Two ports since Patch 1.1.0.0: the standard port, default 7777, on TCP ("Server traffic, HTTPS API") and UDP ("Game traffic, Lightweight Query API"); and the Reliable Messaging port, default 8888, TCP (E1).
  - `-Port=<portnum>` moves the standard port; if it is in use the server tries the next higher port until one is free. `-ReliablePort=<portnum>` moves the reliable port; if it is in use the server fails to initialise. `-ExternalReliablePort=<portnum>` is for external remapping of the reliable port (E1, E2).
  - The standard port can also be set in `Engine.ini`, section `[URL]`, key `Port` (E3).
  - 15000 and 15777 are no longer used since Patch 1.0 (E1).
  - The FRM capture agrees on 7777 for the HTTPS API: "by default, at `https://<ServerIP>:7777/api/v1/`" (`frm-dedicated-server.md` E1), also a community source.
NOT FOUND (recorded, not guessed):
  - An official Coffee Stain statement of the ports or arguments (see Source kind).
  - An INI equivalent for `-ReliablePort` or `-ExternalReliablePort`: E3 gives an INI example for `-Port` only.
---

### E1 — Port forwarding and firewall settings: the ports and their arguments (lines 117-138)

```wikitext
== Port forwarding and firewall settings ==
For the server to be reachable from the internet, ensure that the router has the ports forwarded, and that the server running the game server process has its firewall rules set to allow listening on the ports.

As of [[Patch 1.1.0.0]], a Satisfactory server requires two ports to be forwarded to function properly - a standard Port (default 7777) and a Reliable Messaging Port (default 8888).

{| class="wikitable"
!style="width:10%"|Port Number!!style="width:10%"|Protocol!!style="width:20%"|Relevant Command-line Parameters!!style="width:20%"|Usage
|-
|7777||TCP||<code>-Port=</code>||Server traffic, HTTPS API
|-
|7777||UDP||<code>-Port=</code> ||Game traffic, Lightweight Query API
|-
|8888||TCP||<code>-ReliablePort=</code>, <code>-ExternalReliablePort=</code>||Game traffic, Reliable messaging
|}

(As of [[Patch 1.0]], port numbers 15000 and 15777 are no longer used.)

The standard port can be set using the <code>-Port</code> parameter upon server startup, e.g. <code>-Port=10000</code> to run the game server on port number <code>10000</code>. The value must be an integer between 0 and 65535. If the default port number is in use, the next higher one will be checked until an available port number is found, which will then be used. The reliable port can be set using the <code>-ReliablePort=</code> parameter. If specified, the server will attempt to bind to this port and fail to initialize if the port is unavailable.

Port redirection is not supported at the moment for the standard port, so the external/internal port numbers must match on the port forward rule(s) (eg: do not forward internal port number 7777 as external port number 7778 on the router).
The reliable port can be remapped via the <code>-ExternalReliablePort=</code> command-line parameter.
If multiple instances of the server are to be available on one public IP, override and set a unique port number per instance, or use the [[Patch 1.1.0.0#Dedicated_Server_-_Port_Forwarding_Updates|automatic port allocation configuration]].
```

### E2 — Command line options: the three port options (lines 243-256)

```wikitext
=== Command line options ===
The below table outlines the available options for use when starting the server, either from the command-line or through Steam (via editing the Properties of the Dedicated Server's entry in Tools):

{| class="wikitable"
!style="width:25%"|Option !! Description
|-
|<code>-Port=<portnum></code>
|Override the port the server uses. The default port is 7777 (UDP and TCP). If the specified port is in use, the server will increment the port number and continue trying port numbers until an available one is found. 
|-
|<code>-ReliablePort=<portnum></code>
|Override the reliable messaging port the server uses. The default port is 8888 (TCP). If the specified port is in use, the server will fail to initialize.
|-
|<code>-ExternalReliablePort=<portnum></code>
|Use with the <code>-ReliablePort</code> option if external port remapping is used.
```

### E3 — The INI equivalent of -Port (lines 279-286)

```wikitext
NOTE: Options may also be set via INI files, for example:
{| class="wikitable"
!style="width:25%"|CLI parameter!!style="width:25%"|INI file
|-
|<code>-Port=<portnum></code>
|<code>Engine.ini</code><syntaxhighlight lang="ini">[URL]
Port=<portnum></syntaxhighlight>
|}
```
