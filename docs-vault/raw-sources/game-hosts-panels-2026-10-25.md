Source: public support pages of Satisfactory server hosts and of the modding docs' notes for hosts:
- SML docs, "Satisfactory Mod Manager for Server Hosts", https://docs.ficsit.app/satisfactory-modding/latest/CommunityResources/ServerHostSmmInfo.html
- G-Portal wiki, https://www.g-portal.com/wiki/en/satisfactory-how-do-i-install-mods-on-my-server/ (page metadata `dateModified` 2026-07-23)
- Nodecraft, https://nodecraft.com/support/games/satisfactory/how-to-mod-satisfactory-on-a-nodecraft-server.md (front matter `updated` 2026-07-14)
- Supercraft, https://supercraft.host/wiki/satisfactory/satisfactory_remote_monitoring_dashboard/ (page metadata `dateModified` 2026-10-25)
Captured: 2026-10-25
Method: plain HTTPS GET with curl, HTML stripped to text, the lines below grepped and copied unedited. No account, sign-up or purchase with any host. These pages carry no licence permitting redistribution, so only the excerpts this repo cites are kept, verbatim. Read together with `game-hosts-mods-2026-10-20.md` (five other hosts) and `sml-dedicated-server-setup.md` (the modding docs' lists of supported and unsupported hosts).
Why it is here: ADR-0057 (hosting coverage): what access each hosting type gives (files, ports, startup, outbound network).
FINDINGS (as the pages state them):
  - The modding docs ask hosts for (S)FTP access that does not hide files or block dlls, and say "Bonus points" for exposing optional extra ports, naming FRM's TCP port (E1). Extra ports are therefore something a host may NOT offer by default.
  - G-Portal: FTP (not SFTP, not the Mod Manager) and the "Windows Server" build of a mod (E2). The page names no Linux build, no shell and no ports.
  - Nodecraft: SFTP on port 2022 after enabling it in the panel (E3). The page says nothing about Linux or Windows, ports for mods, a shell, or outbound traffic.
  - Supercraft's FRM page says "Most hosts default-block non-game ports" and tells the reader to ask a managed host whether FRM's port needs opening (E4). Its sample config (`HTTPPort`, `HTTPSPort` 8443) does not match FRM 1.5.4's documented `uWS.Port` setting (`frm-config-port-1.5.4-2026-10-20.md` E3), so treat its config text as stale.
NOT FOUND (recorded, not guessed):
  - Any of these hosts stating whether the game process may open outbound connections (same gap as `game-hosts-mods-2026-10-20.md`).
  - A shell or SSH on any rented host's page (none of the pages mentions one).
NOT CAPTURED: Nitrado (the page at server.nitrado.net renders in JavaScript; a plain GET returned an empty shell, 2026-10-25) and Shockbyte (HTTP 403 to a script, as on 2026-10-20). A web search summary said Nitrado's Satisfactory page states servers "do not support mods"; that is a search snippet, not a capture: [NEEDS VERIFICATION]. The modding docs list Nitrado as an incomplete modding experience (`sml-dedicated-server-setup.md`, "Unsupported Hosts").

### E1 — SML docs: what a host should allow, and the extra-port "bonus"

```
Allow (S)FTP access without hiding files or blocking dlls
SMM must view the game executable file to detect the server.
Many mods have custom dlls required to function. Note that all dlls are scanned by virustotal before they are allowed on ficsit.app.
Some mods create or read other files and folders in the game install directory to function properly.
Allow the user to temporarily stop the game server without it automatically starting up again
(Bonus points) Also expose optional extra port(s):
In addition to the ports used by the base game, some server monitoring mods like Ficsit Remote Monitoring use a TCP port for communications.
Port(s) can be configured for mods to facilitate flexibility in assignment. See mod documentation or reach out to the mod creator/maintainer for details.
```

### E2 — G-Portal: FTP only, no Mod Manager, the Windows Server build

```
To be able to use mods in Satisfactory, you must upload them to your GPORTAL server via FTP (e.g. with Filezilla) and then update them manually. You can NOT use the Satisfactory Mod Manager for this.
For the latest version, go to “Download…” and select “Windows Server”
Then upload this mod folder to your server under “Mods”
```

### E3 — Nodecraft: SFTP on port 2022

```
To upload **mods** to your dedicated **server**, you need to enable **SFTP access**.
3. Go to **Server Files** and then **FTP/SFTP Access**.
**Port**: 2022 (default SFTP port for Nodecraft)
```

### E4 — Supercraft: extra ports on managed hosting

```
If you're running on managed hosting, ask whether port 8080 needs to be opened explicitly. Most hosts default-block non-game ports.
```
