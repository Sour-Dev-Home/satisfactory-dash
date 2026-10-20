Source: the public "install mods" pages of five rented Satisfactory server hosts:
- Nodecraft, https://nodecraft.com/support/games/satisfactory/how-to-mod-satisfactory-on-a-nodecraft-server (page says "Updated 07/14/26")
- GameServerKings, https://www.gameserverkings.com/knowledge-base/satisfactory/how-to-install-mods/ ("Updated September 28, 2026")
- LOW.MS, https://low.ms/blog/how-to-set-up-mods-satisfactory-dedicated-server (dated 7 April 2026)
- Game Host Bros, https://guides.gamehostbros.com/games/satisfactory/install-mods (redirects to https://www.gamehostbros.com/guides/games/satisfactory/install-mods; "Updated May 25, 2026")
- XGamingServer, https://xgamingserver.com/docs/satisfactory/mod-setup and https://xgamingserver.com/blog/satisfactory-how-to-install-mods-on-server/ (dated June 13, 2026)
Captured: 2026-10-20
Method: plain HTTPS GET of each page, HTML stripped to text. No account, sign-up or purchase with any host. These pages carry no licence permitting redistribution, so only the excerpts this repo cites are kept, verbatim.
NOT CAPTURED: Shockbyte, https://shockbyte.com/help/knowledgebase/articles/how-to-install-mods-on-your-satisfactory-server, answered HTTP 403 to a script; https://xgamingserver.com/docs/satisfactory/install-mods answered HTTP 410.
Why it is here: issue #472, which hosts allow a custom mod and whether they state outbound network access from the game process (ADR-0039 G3 readiness item 4), for `wiki/mod-maintenance.md`.

## Findings

- All five install mods with Satisfactory Mod Manager (SMM) over SFTP, from ficsit.app (E1, E2, E6, E8, E9); LOW.MS also has a panel mod manager that installs from ficsit.app (E5).
- LOW.MS says its SFTP path works for "a mod that is not yet on ficsit.app" (E6). GameServerKings (E4) and XGamingServer (E10) document uploading mod files over SFTP by hand, of mods taken from ficsit.app; none of the other pages says whether a mod not on ficsit.app may be uploaded.
- GameServerKings' servers run the Linux server build: a mod needs a Linux server target on ficsit.app to run there (E3, E4).
- None of the five pages says anything about outbound network access from the game server process.

### E1 — Nodecraft: install through SMM over SFTP

```
Satisfactory Mod Manager (SMM) installed on your local machine. Download it from ficsit.app.
To apply mods to your Nodecraft server, you'll need to configure SMM to connect to your server using the SFTP credentials.
In the SMM, search for mods you'd like to install on your server. You can browse by category, popularity, or search for specific mods.
Once you've found the mods that you would like to install, click the download button next to it.
```

### E2 — GameServerKings: mods come from ficsit.app

```
Satisfactory mods all come from one place: the Satisfactory Mod Repository at ficsit.app, installed with Satisfactory Mod Manager (SMM). SMM downloads each mod, its dependencies and the Satisfactory Mod Loader (SML) into the right folders, so you never unzip anything yourself. SMM can also connect to a dedicated server over SFTP, which means one app manages both your own game and your server.
```

### E3 — GameServerKings: Linux server builds, and an untested-by-host note

```
These steps follow the Satisfactory Modding team's dedicated-server documentation and our SFTP setup, but we haven't yet run SMM against one of our Satisfactory servers ourselves.
Select the server in the install dropdown. With the funnel on Compatible, SMM lists only mods that have a dedicated-server build. On ficsit.app itself, a mod's Latest Version section shows a Server column, and a tick for Linux server means it will run on ours.
```

### E4 — GameServerKings: manual upload

```
Use SMM if you can. The modding team does not support manually installed servers, and a manual install is where most broken servers come from. If you have to:
On the mod's ficsit.app page, open Versions, choose a version whose game-version range includes your server's build, and use the Download dropdown to get the LinuxServer build.
Mods arrive as .smod or .zip archives. Unzip them on your computer, then upload the folder over SFTP.
```

### E5 — LOW.MS: panel mod manager

```
LOW.MS ships a built-in mod manager – the [NEW] SML Fiscit Mod Manager entry in your service's left-hand sidebar. It handles SML installation, browses the ficsit.app catalogue inside the panel, and installs mods with a single click.
```

### E6 — LOW.MS: SFTP, including mods not on ficsit.app

```
If you would rather manage mod files directly – for example because you want to use SMM's profile-export feature to keep a group of friends in sync, or because you are installing a mod that is not yet on ficsit.app – the SFTP path still works.
```

### E7 — Game Host Bros: date

```
3 min read·Updated May 25, 2026
```

### E8 — Game Host Bros: install through SMM over SFTP

```
This guide will cover how to find and install mods on your Satisfactory server, this method focuses on using the Satisfactory Mod Manager (SMM) tool to easily upload mods to your server.
In the sidebar, go to Files and click SFTP in the top-right to view your Host, Username, and Password.
Run Satisfactory Mod Manager and select Manage Servers in the left-hand sidebar.
```

### E9 — XGamingServer docs: install through SMM

```
Satisfactory supports mods via SML (Satisfactory Mod Loader) and the ficsit.app mod portal.
Install Satisfactory Mod Manager (SMM) from GitHub
Point SMM at your dedicated server's install directory
Browse and install mods with one click — dependencies are auto-resolved
```

### E10 — XGamingServer blog: manual SFTP upload

```
Method 2: Manual SFTP upload (fallback)
If SMM can't reach your server (firewall, locked-down host, or you just prefer manual control), you can transfer files with an SFTP client like FileZilla or WinSCP. The catch is that you become responsible for the parts SMM normally handles for you:
Install the matching SML version and upload every mod — plus each mod's dependencies — into the FactoryGame/Mods directory.
```
