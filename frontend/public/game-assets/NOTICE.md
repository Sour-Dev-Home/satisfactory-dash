# Game assets

The images in this folder (`resources/*.webp`, the Planner's building icons in `buildings/*.webp` and its item icons
in `items/*.webp`) are Satisfactory's own resource, building and item icons, © Coffee Stain Studios. They were exported
from the owner's game install with FModel and downscaled to WebP: 64x64 for resources and buildings, and 32x32, 64x64
and 128x128 for items.

- They are **not** covered by this repository's AGPL-3.0-only licence. The licence applies to the code,
  not to these files.
- They are used as fan content in a free, non-commercial tool, to label resource nodes on the map and buildings and
  the items on links in the Planner. Satisfactory and its icons are © Coffee Stain Studios. This project is not
  affiliated with them.
- They will be removed on request from the rights holder.

To rebuild one: `npx sharp-cli@6.1.0 -i <icon>.png -o . -f webp --quality 85 resize 64 64 --fit contain`.

To rebuild every item icon from the owner's FModel export: `node scripts/dev/build-item-icons.mjs --src <the export's
Resource folder>`. It runs the same sharp-cli and settings at 32, 64 and 128 px, and writes exactly the files
`frontend/src/planner/graph/itemIcons.ts` names.
