# Game assets

The images in this folder (`resources/*.webp`, and the Planner's building icons in `buildings/*.webp`) are
Satisfactory's own resource and building icons, © Coffee Stain Studios. They were exported from the owner's game install with FModel and downscaled to 64x64 WebP.

- They are **not** covered by this repository's AGPL-3.0-only licence. The licence applies to the code,
  not to these files.
- They are used as fan content in a free, non-commercial tool, to label resource nodes on the map and buildings in the Planner.
  Satisfactory and its icons are © Coffee Stain Studios. This project is not affiliated with them.
- They will be removed on request from the rights holder.

To rebuild one: `npx sharp-cli@6.1.0 -i <icon>.png -o . -f webp --quality 85 resize 64 64 --fit contain`.
