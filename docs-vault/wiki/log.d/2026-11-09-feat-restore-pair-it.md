- **"Pair it" is back for mod 0.3.0.** The mod's device-code pairing passed its runner checks (Windows and Linux, against
  backend images at #874), so the link #870 removed returns beside Add your server (`AddServer.tsx`, linking `/app/pair`).
  The pairing steps are back too, in `connecting-a-server.md` ("Or pair from the server's console") and `getting-started.md`.
  They now match the mod: 0.3.0 or later; the code shows in the console and `FactoryGame.log`, and in in-game chat when
  exactly one player is on; there's no `pairing.txt`; a code lasts 15 minutes, with fresh ones for an hour after the server
  starts (a join or a restart brings a new one); and a code in the config file wins.
