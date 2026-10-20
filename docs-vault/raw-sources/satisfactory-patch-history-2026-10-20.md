Source: the Satisfactory Wiki (satisfactory.wiki.gg), its patch navigation template https://satisfactory.wiki.gg/wiki/Template:PatchesNav (where https://satisfactory.wiki.gg/wiki/Patches redirects) and one page per patch, https://satisfactory.wiki.gg/wiki/Patch_<version> (e.g. https://satisfactory.wiki.gg/wiki/Patch_1.1.1.0)
Captured: 2026-10-20
Method: `?action=raw` for the template; the MediaWiki API (`api.php?action=query&prop=revisions&rvprop=content|ids`) for each patch page linked from its 1.0, 1.1 and 1.2 groups, keeping the `{{Patch}}` infobox's `date`, `build` and `steam` fields and the page revision id. The wiki is CC BY-NC-SA 4.0 (its API `rightsinfo`); this is a community wiki, not Coffee Stain's own record, and each row links Coffee Stain's Steam announcement it was taken from.
Why it is here: issue #472, the game's side of the SML breakage history for `wiki/mod-maintenance.md`. SML's side is `sml-releases-2026-10-20.md`.

## Findings

- 1.0 reached the stable branch on 2024-09-10 (build 365306), 1.1 on 2025-06-10 (1.1.1.0, build 416835) and 1.2 on 2026-06-02 (1.2.2.2, build 491125) (E1, E2).
- 1.1 opened on Experimental on 2025-04-01 (1.1.0.0) and 1.2 on 2026-03-17 (1.2.0.0) (E1, E2).
- The latest patch listed is 1.2.4.0 / 1.2.4.1, 2026-08-11 (1.2.4.1 links the 1.2.4.0 page, E1).

### E1 — Template:PatchesNav, the 1.0 to 1.2 groups

```
| group1 = 1.2
| list1 = [[Patch 1.2.2.2|1.2.2.2]] {{*}} [[Patch 1.2.3.0|1.2.3.0]] {{*}} [[Patch 1.2.3.1|1.2.3.1]] {{*}} [[Patch 1.2.4.0|1.2.4.0]] {{*}} [[Patch 1.2.4.0|1.2.4.1]]
| group2 = Experimental 1.2
| list2 = [[Patch 1.2.0.0|1.2.0.0]] {{*}} [[Patch 1.2.1.0|1.2.1.0]] {{*}} [[Patch 1.2.2.0|1.2.2.0]] {{*}} [[Patch 1.2.2.1|1.2.2.1]] {{*}} [[Patch 1.2.2.2 (Experimental)|1.2.2.2 (Experimental)]]
| group3 = 1.1
| list3 = [[Patch 1.1.1.0|1.1.1.0]] {{*}} [[Patch 1.1.1.1|1.1.1.1]] {{*}} [[Patch 1.1.1.2|1.1.1.2]] {{*}} [[Patch 1.1.1.3|1.1.1.3]] {{*}} [[Patch 1.1.1.4|1.1.1.4]] {{*}} [[Patch 1.1.1.7|1.1.1.7]] {{*}} [[Patch 1.1.2.0|1.1.2.0]] {{*}} [[Patch 1.1.2.1|1.1.2.1]] {{*}} [[Patch 1.1.2.2|1.1.2.2]]
| group4 = Experimental 1.1
| list4 = [[Patch 1.1.0.0|1.1.0.0]] {{*}} [[Patch 1.1.0.1|1.1.0.1]] {{*}} [[Patch 1.1.0.2|1.1.0.2]] {{*}} [[Patch 1.1.0.3|1.1.0.3]] {{*}} [[Patch 1.1.0.4|1.1.0.4]] {{*}} [[Patch 1.1.0.5|1.1.0.5]] {{*}} [[Patch 1.1.0.6|1.1.0.6]] {{*}} [[Patch 1.1.1.5|1.1.1.5]] {{*}} [[Patch 1.1.1.6|1.1.1.6]] {{*}} [[Patch 1.1.3.0|1.1.3.0]] {{*}} [[Patch 1.1.3.1|1.1.3.1]]
| group5 = 1.0
| list5 = [[Patch 1.0|1.0]] {{*}} [[Patch 1.0.0.1|1.0.0.1]] {{*}} [[Patch 1.0.0.2|1.0.0.2]] {{*}} [[Patch 1.0.0.3|1.0.0.3]] {{*}} [[Patch 1.0.0.4|1.0.0.4]] {{*}} [[Patch 1.0.0.5|1.0.0.5]] {{*}} [[Patch 1.0.0.6|1.0.0.6]] {{*}} [[Patch 1.0.0.7|1.0.0.7]] {{*}} [[Patch 1.0.1.0|1.0.1.0]] {{*}} [[Patch 1.0.1.1|1.0.1.1]] {{*}} [[Patch 1.0.1.2|1.0.1.2]] {{*}} [[Patch 1.0.1.3|1.0.1.3]] {{*}} [[Patch 1.0.1.4|1.0.1.4]]
| group6 = Experimental 1.0
| list6 = [[Patch 1.0.1.5|1.0.1.5]] {{*}} [[Patch 1.0.1.6|1.0.1.6]]
```

### E2 — Each patch page's `{{Patch}}` infobox: date, build, Steam announcement, page revision

Branch is the E1 group the patch is listed in (S = stable, X = Experimental).

```
date        patch                          br build   rev    steam
2024-09-10  Patch 1.0                      S  365306  58677  https://steamcommunity.com/games/526870/announcements/detail/4567301015235883040
2024-09-12  Patch 1.0.0.1                  S  366202  58685  https://store.steampowered.com/news/app/526870/view/4615715344788357373
2024-09-19  Patch 1.0.0.2                  S  367101  58688  https://store.steampowered.com/news/app/526870/view/4656248375959798354
2024-09-25  Patch 1.0.0.3                  S  368883  58736  https://store.steampowered.com/news/app/526870/view/4653997209640642308?l=english
2024-10-15  Patch 1.0.0.4                  S  372858  58810  https://store.steampowered.com/news/app/526870/view/4505379961376082329?l=english
2024-11-04  Patch 1.0.0.5                  S  377620  58846  https://store.steampowered.com/news/app/526870/view/4476108195413098876
2024-11-07  Patch 1.0.0.6                  S  378208  58849  https://store.steampowered.com/news/app/526870/view/4456968534728114275
2024-11-14  Patch 1.0.0.7                  S  379322  58852  https://store.steampowered.com/news/app/526870/view/6539884087960666208
2024-11-28  Patch 1.0.1.0                  S  382498  58892  https://store.steampowered.com/news/app/526870/view/4456970437737317052
2024-12-03  Patch 1.0.1.1                  S  383233  58902  https://store.steampowered.com/news/app/526870/view/4456970437737317392
2024-12-05  Patch 1.0.1.2                  S  383729  58906  https://store.steampowered.com/news/app/526870/view/4456970437737318182
2024-12-09  Patch 1.0.1.3                  S  384038  58909  https://store.steampowered.com/news/app/526870/view/512943879502168877
2024-12-20  Patch 1.0.1.4                  S  385279  58914  https://steamcommunity.com/games/526870/announcements/detail/520826430987174077
2025-02-18  Patch 1.0.1.5                  X  395236  58986  https://store.steampowered.com/news/app/526870/view/498313608291156664
2025-03-11  Patch 1.0.1.6                  X  399795  58989  https://store.steampowered.com/news/app/526870/view/512951942084822988
2025-04-01  Patch 1.1.0.0                  X  403662  61009  https://store.steampowered.com/news/app/526870/view/520835140699555676
2025-04-04  Patch 1.1.0.1                  X  404250  58996  https://store.steampowered.com/news/app/526870/view/520835774959059546
2025-04-09  Patch 1.1.0.2                  X  404994  59044  https://store.steampowered.com/news/app/526870/view/543354406737805515
2025-04-17  Patch 1.1.0.3                  X  406341  59053  https://store.steampowered.com/news/app/526870/view/520837042930712785
2025-05-12  Patch 1.1.0.4                  X  410840  59082  https://store.steampowered.com/news/app/526870/view/520838945346422708
2025-06-02  Patch 1.1.0.5                  X  415558  59102  https://store.steampowered.com/news/app/526870/view/520840848816999801
2025-06-09  Patch 1.1.0.6                  X  416835  59112  https://store.steampowered.com/news/app/526870/view/520841474254834517
2025-06-10  Patch 1.1.1.0                  S  416835  59131  https://store.steampowered.com/news/app/526870/view/520841474254835359
2025-06-18  Patch 1.1.1.1                  S  418783  59140  https://store.steampowered.com/news/app/526870/view/520842750961123376
2025-07-17  Patch 1.1.1.2                  S  424353  59148  https://store.steampowered.com/news/app/526870/view/520845377984790640
2025-09-02  Patch 1.1.1.3                  S  432215  62145  https://store.steampowered.com/news/app/526870/view/520849092932273233
2025-09-08  Patch 1.1.1.4                  S  433351  59610  https://store.steampowered.com/news/app/526870/view/520849726239672289
2025-10-07  Patch 1.1.1.5                  X  442229  59942  https://store.steampowered.com/news/app/526870/view/499459531596630667
2025-10-10  Patch 1.1.1.6                  X  445319  59946  https://store.steampowered.com/news/app/526870/view/499460799857688921
2025-11-11  Patch 1.1.1.7                  S  455399  60239  https://store.steampowered.com/news/app/526870/view/614305130088500042
2025-11-26  Patch 1.1.2.0                  S  458806  60509  https://store.steampowered.com/news/app/526870/view/508472441549357212
2025-12-01  Patch 1.1.2.1                  S  460533  60534  https://store.steampowered.com/news/app/526870/view/508472441549357622
2025-12-19  Patch 1.1.2.2                  S  463028  60606  https://store.steampowered.com/news/app/526870/view/508474344447411324
2026-02-10  Patch 1.1.3.0                  X  472072  60887  https://store.steampowered.com/news/app/526870/view/494967984678242678
2026-02-19  Patch 1.1.3.1                  X  474567  60931  https://store.steampowered.com/news/app/526870/view/496095152751772888
2026-03-17  Patch 1.2.0.0                  X  480321  62154  https://store.steampowered.com/news/app/526870/view/515237350113019032
2026-03-24  Patch 1.2.1.0                  X  481836  61232  https://store.steampowered.com/news/app/526870/view/497223585377552287
2026-04-28  Patch 1.2.2.0                  X  488068  61557  https://store.steampowered.com/news/app/526870/view/512989355492508995
2026-05-07  Patch 1.2.2.1                  X  489969  61678  https://store.steampowered.com/news/app/526870/view/699890007742088081
2026-05-19  Patch 1.2.2.2 (Experimental)   X  491125  62143  https://store.steampowered.com/news/app/526870/view/664987745725188055
2026-06-02  Patch 1.2.2.2                  S  491125  62815  https://store.steampowered.com/news/app/526870/view/695387676933621084
2026-06-11  Patch 1.2.3.0                  S  493833  62144  https://store.steampowered.com/news/app/526870/view/686382380150161913
2026-06-24  Patch 1.2.3.1                  S  495413  62307  https://store.steampowered.com/news/app/526870/view/712279347386384662
2026-08-11  Patch 1.2.4.0                  S  502094  62808  https://store.steampowered.com/news/app/526870/view/716786751176181500
```
