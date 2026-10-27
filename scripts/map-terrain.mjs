#!/usr/bin/env node
// Traces the game's world map texture into the Map page's terrain base map (ADR-0023 amendment, #571): land and
// water, plus one tint per terrain class, as simplified polygons in world metres. Only these shapes ship; the
// texture never enters the repo. Dependency-free: Node's zlib decodes the PNG (8-bit RGB or RGBA, not interlaced;
// downscale with `npx sharp-cli@6.1.0 ... resize 1024` first, which writes that format).
//
//   node scripts/map-terrain.mjs sample <tile.png...> [--cols N]      the most common colours, to fill the palette
//   node scripts/map-terrain.mjs trace <palette.json> <out.json> <tile.png...> [--cols N]
//
// Tiles go row by row (the game's SlicedMap/Map_<col>-<row>: 0-0, 1-0, 0-1, 1-1). palette.json: { "boundsM":
//   {minX,maxX,minY,maxY}, "classes": [{ "id", "colors": [[r,g,b], ...], "land"?, "draw"? }, ...], "smoothRadius",
//   "minAreaPx", "tolerancePx" }. By default the first class is the undrawn background and every other class is land
//   with a tint; `land: false` and `draw: false` say otherwise (shallows: tinted, not land; the void: neither).

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG into RGBA bytes. */
export function decodePng(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((b, i) => buf[i] === b)) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  for (let at = 8; at < buf.length; ) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const color = data[9];
      if (depth !== 8 || (color !== 2 && color !== 6) || data[12] !== 0) {
        throw new Error(`unsupported PNG (depth ${depth}, colour type ${color}, interlace ${data[12]}): re-save it with sharp-cli`);
      }
      channels = color === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = src[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = line[x * channels];
      out[o + 1] = line[x * channels + 1];
      out[o + 2] = line[x * channels + 2];
      out[o + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
    prev.set(line);
  }
  return { width, height, rgba: out };
}

/** Each pixel's class: the index of the class with the nearest sample colour. Transparent pixels are class 0. */
export function classify({ width, height, rgba }, classes) {
  const samples = classes.flatMap((c, k) => c.colors.map((rgb) => [k, ...rgb]));
  const labels = new Uint8Array(width * height);
  for (let i = 0; i < labels.length; i++) {
    if (rgba[i * 4 + 3] < 128) continue;
    let best = 0;
    let bestD = Infinity;
    for (const [k, r, g, b] of samples) {
      const d = (rgba[i * 4] - r) ** 2 + (rgba[i * 4 + 1] - g) ** 2 + (rgba[i * 4 + 2] - b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    labels[i] = best;
  }
  return labels;
}

/** A majority filter over a (2r+1)² window: removes speckle so the traced edges stay calm. */
export function majority(labels, width, height, r, classCount) {
  if (r <= 0) return labels;
  const out = new Uint8Array(labels.length);
  const count = new Uint32Array(classCount);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      count.fill(0);
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(width - 1, Math.max(0, x + dx));
          count[labels[yy * width + xx]]++;
        }
      }
      let best = labels[y * width + x];
      for (let k = 0; k < classCount; k++) if (count[k] > count[best]) best = k;
      out[y * width + x] = best;
    }
  }
  return out;
}

/**
 * The closed boundaries of a mask, along pixel edges, in pixel-corner coordinates. Each ring keeps the inside on its
 * right in screen coordinates; outer rings and holes come out in opposite directions, so an even-odd fill draws them
 * right without knowing which is which. At a diagonal touch the two pixels stay separate rings.
 */
export function traceRings(mask, width, height) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  // Directed boundary edges, keyed by their start corner.
  const next = new Map();
  const key = (x, y) => y * (width + 1) + x;
  const add = (x0, y0, x1, y1) => {
    const k = key(x0, y0);
    const list = next.get(k);
    if (list) list.push([x1, y1]);
    else next.set(k, [[x1, y1]]);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) add(x, y, x + 1, y);
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const rings = [];
  for (const [startKey, list] of next) {
    while (list.length > 0) {
      const sx = startKey % (width + 1);
      const sy = (startKey - sx) / (width + 1);
      const ring = [[sx, sy]];
      let [px, py] = [sx, sy];
      let [cx, cy] = list.pop();
      while (!(cx === sx && cy === sy)) {
        ring.push([cx, cy]);
        const options = next.get(key(cx, cy));
        // Two ways on at a corner (a diagonal touch): turn right, which keeps the touching pixels apart.
        let pick = 0;
        if (options.length > 1) {
          const dx = cx - px;
          const dy = cy - py;
          pick = options.findIndex(([nx, ny]) => (nx - cx) === -dy && (ny - cy) === dx);
          if (pick < 0) pick = 0;
        }
        const [nx, ny] = options.splice(pick, 1)[0];
        [px, py, cx, cy] = [cx, cy, nx, ny];
      }
      rings.push(ring);
    }
  }
  return rings;
}

/** The shoelace area of a ring, unsigned. */
export function ringArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

/** Douglas-Peucker on a closed ring (split at its farthest pair of points so the closure is handled). */
export function simplifyRing(ring, tolerance) {
  if (ring.length <= 4) return ring;
  const dp = (pts) => {
    if (pts.length <= 2) return pts;
    const [ax, ay] = pts[0];
    const [bx, by] = pts[pts.length - 1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let far = 0;
    let at = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > far) {
        far = d;
        at = i;
      }
    }
    if (far <= tolerance) return [pts[0], pts[pts.length - 1]];
    return [...dp(pts.slice(0, at + 1)).slice(0, -1), ...dp(pts.slice(at))];
  };
  let far = 0;
  let at = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > far) {
      far = d;
      at = i;
    }
  }
  const a = dp(ring.slice(0, at + 1));
  const b = dp([...ring.slice(at), ring[0]]);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** One round of Chaikin corner cutting: softens the pixel staircase into an organic coast. */
export function chaikin(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    out.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
  }
  return out;
}

/** Joins equal-sized tiles, given row by row, into one image. */
export function stitch(tiles, cols) {
  const { width: tw, height: th } = tiles[0];
  const rows = Math.ceil(tiles.length / cols);
  const width = tw * cols;
  const height = th * rows;
  const rgba = new Uint8Array(width * height * 4);
  tiles.forEach((tile, i) => {
    if (tile.width !== tw || tile.height !== th) throw new Error(`tile ${i} is ${tile.width}x${tile.height}, not ${tw}x${th}`);
    const ox = (i % cols) * tw;
    const oy = Math.floor(i / cols) * th;
    for (let y = 0; y < th; y++) rgba.set(tile.rgba.subarray(y * tw * 4, (y + 1) * tw * 4), ((oy + y) * width + ox) * 4);
  });
  return { width, height, rgba };
}

/**
 * Traces the land and each drawn class; returns the terrain file's content, in whole metres. A class with
 * `land: false` (the sea, shallows, the void past the world's edge) is not land; one with `draw: false` gets no tint.
 */
export function traceTerrain(image, palette) {
  const { width, height } = image;
  const { classes, boundsM, smoothRadius = 2, minAreaPx = 40, tolerancePx = 0.8 } = palette;
  const labels = majority(classify(image, classes), width, height, smoothRadius, classes.length);
  const sx = (boundsM.maxX - boundsM.minX) / width;
  const sy = (boundsM.maxY - boundsM.minY) / height;
  const toWorld = ([x, y]) => [Math.round(boundsM.minX + x * sx), Math.round(boundsM.minY + y * sy)];
  // One round of corner cutting, then a second, finer simplify drops the points it added along straight runs.
  const shapes = (test, minArea = minAreaPx) => {
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i++) mask[i] = test(labels[i]) ? 1 : 0;
    return traceRings(mask, width, height)
      .filter((r) => ringArea(r) >= minArea)
      .map((r) => simplifyRing(chaikin(simplifyRing(r, tolerancePx)), tolerancePx / 3).map(toWorld))
      .map((r) => r.filter((p, i) => i === 0 || p[0] !== r[i - 1][0] || p[1] !== r[i - 1][1]))
      .filter((r) => r.length >= 3)
      .map((r) => r.flat());
  };
  const isLand = classes.map((c, k) => (c.land ?? k !== 0) === true);
  return {
    boundsM,
    land: shapes((k) => isLand[k]),
    classes: classes
      .map((c, k) => ({ c, k }))
      .filter(({ c, k }) => c.draw ?? k !== 0)
      .map(({ c, k }) => ({ id: c.id, rings: shapes((l) => l === k, c.minAreaPx) })),
  };
}

/** The most common colours, quantised to 16 levels per channel, for picking the palette by eye. */
export function sampleColors({ rgba }, top = 24) {
  const counts = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const k = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const total = rgba.length / 4;
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([k, n]) => ({ rgb: [((k >> 8) & 15) * 16 + 8, ((k >> 4) & 15) * 16 + 8, (k & 15) * 16 + 8], share: n / total }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [cmd, ...args] = process.argv.slice(2);
  // Tiles row by row; `--cols N` (default: a square grid) when there are several.
  const load = (files) => {
    const at = files.indexOf("--cols");
    const cols = at >= 0 ? Number(files.splice(at, 2)[1]) : Math.round(Math.sqrt(files.length));
    const tiles = files.map((f) => decodePng(readFileSync(f)));
    return tiles.length === 1 ? tiles[0] : stitch(tiles, cols);
  };
  if (cmd === "sample" && args.length > 0) {
    for (const { rgb, share } of sampleColors(load(args))) console.log(`[${rgb.join(", ")}]  ${(share * 100).toFixed(1)}%`);
  } else if (cmd === "trace" && args.length >= 3) {
    const [paletteFile, outFile, ...files] = args;
    const terrain = traceTerrain(load(files), JSON.parse(readFileSync(paletteFile, "utf8")));
    const text = JSON.stringify(terrain);
    writeFileSync(outFile, text + "\n");
    const points = terrain.land.reduce((n, r) => n + r.length / 2, 0) + terrain.classes.reduce((n, c) => n + c.rings.reduce((m, r) => m + r.length / 2, 0), 0);
    console.log(`wrote ${outFile}: ${(text.length / 1024).toFixed(0)} kB, ${points} points, ${terrain.land.length} land rings`);
  } else {
    console.error("usage: map-terrain.mjs sample <tile.png...> [--cols N] | trace <palette.json> <out.json> <tile.png...> [--cols N]");
    process.exit(2);
  }
}
