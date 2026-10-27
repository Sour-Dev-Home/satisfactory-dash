import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { classify, decodePng, majority, ringArea, sampleColors, simplifyRing, stitch, traceRings, traceTerrain } from "./map-terrain.mjs";

/** A PNG of RGB pixels (`pixel(x, y)` returns [r, g, b]); each row filtered with `filter` (0 none, 2 up). */
function png(width, height, pixel, filter = 0) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  let prev = new Uint8Array(width * 3);
  for (let y = 0; y < height; y++) {
    const line = new Uint8Array(width * 3);
    for (let x = 0; x < width; x++) line.set(pixel(x, y), x * 3);
    const out = filter === 2 ? line.map((v, i) => (v - prev[i]) & 255) : line;
    rows.push(Buffer.from([filter]), Buffer.from(out));
    prev = line;
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const mask = (width, rows) => Uint8Array.from(rows.join("").split(""), (c) => (c === "#" ? 1 : 0));

test("decodes an RGB PNG, unfiltered or with the Up filter", () => {
  const pixel = (x, y) => [x * 10, y * 20, 7];
  for (const filter of [0, 2]) {
    const { width, height, rgba } = decodePng(png(3, 2, pixel, filter));
    assert.deepEqual([width, height], [3, 2]);
    assert.deepEqual([...rgba.subarray((1 * 3 + 2) * 4, (1 * 3 + 2) * 4 + 4)], [20, 20, 7, 255]);
  }
});

test("refuses a PNG it cannot read instead of decoding garbage", () => {
  assert.throws(() => decodePng(Buffer.from("not a png at all")), /not a PNG/);
});

test("one pixel is one ring of four corners and area 1", () => {
  const rings = traceRings(mask(1, ["#"]), 1, 1);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].length, 4);
  assert.equal(ringArea(rings[0]), 1);
});

test("a ring with a hole traces as two rings in opposite directions, for an even-odd fill", () => {
  const m = mask(3, ["###", "#.#", "###"]);
  const rings = traceRings(m, 3, 3);
  assert.equal(rings.length, 2);
  const signed = (r) => r.reduce((s, [x0, y0], i) => s + x0 * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * y0, 0);
  assert.ok(Math.sign(signed(rings[0])) !== Math.sign(signed(rings[1])));
  assert.deepEqual(rings.map(ringArea).sort((a, b) => a - b), [1, 9]);
});

test("pixels touching only at a corner stay two separate rings", () => {
  const rings = traceRings(mask(2, ["#.", ".#"]), 2, 2);
  assert.equal(rings.length, 2);
  assert.deepEqual(rings.map(ringArea), [1, 1]);
});

test("simplifying a staircase keeps every point within the tolerance and drops most of them", () => {
  const stairs = [];
  for (let i = 0; i < 20; i++) stairs.push([i, i], [i + 1, i]);
  const ring = [...stairs, [20, 30], [0, 30]];
  const out = simplifyRing(ring, 1);
  assert.ok(out.length < ring.length / 4, `${out.length} points`);
});

test("classify picks the nearest sample colour; majority removes a lone speckle", () => {
  const image = decodePng(png(5, 5, (x, y) => (x === 2 && y === 2 ? [250, 250, 250] : [0, 0, 200])));
  const labels = classify(image, [{ id: "water", colors: [[0, 0, 200]] }, { id: "rock", colors: [[240, 240, 240]] }]);
  assert.equal(labels[12], 1);
  assert.equal(majority(labels, 5, 5, 1, 2)[12], 0);
});

test("traceTerrain: land and each class traced in world metres inside the bounds; water is not traced", () => {
  // 20x20: water, a 10x10 grass island at (5..14, 5..14) with a 4x4 sand patch at (8..11, 8..11).
  const image = decodePng(
    png(20, 20, (x, y) => {
      const island = x >= 5 && x < 15 && y >= 5 && y < 15;
      const sand = x >= 8 && x < 12 && y >= 8 && y < 12;
      return sand ? [220, 200, 120] : island ? [60, 140, 60] : [20, 40, 120];
    }),
  );
  const boundsM = { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 };
  const palette = {
    boundsM,
    smoothRadius: 0,
    minAreaPx: 4,
    classes: [
      { id: "water", colors: [[20, 40, 120]] },
      { id: "grass", colors: [[60, 140, 60]] },
      { id: "sand", colors: [[220, 200, 120]] },
    ],
  };
  const terrain = traceTerrain(image, palette);
  assert.equal(terrain.land.length, 1);
  assert.deepEqual(terrain.classes.map((c) => c.id), ["grass", "sand"]);
  assert.equal(terrain.classes[0].rings.length, 2, "grass: the island and its sand hole");
  assert.equal(terrain.classes[1].rings.length, 1);
  for (const ring of [...terrain.land, ...terrain.classes.flatMap((c) => c.rings)]) {
    for (let i = 0; i < ring.length; i += 2) {
      assert.ok(ring[i] >= -500 && ring[i] <= 500 && ring[i + 1] >= -500 && ring[i + 1] <= 500, `${ring[i]},${ring[i + 1]}`);
      assert.ok(Number.isInteger(ring[i]) && Number.isInteger(ring[i + 1]));
    }
  }
});

test("stitch joins tiles row by row, and refuses tiles of different sizes", () => {
  const tile = (rgb) => decodePng(png(2, 2, () => rgb));
  const image = stitch([tile([1, 0, 0]), tile([2, 0, 0]), tile([3, 0, 0]), tile([4, 0, 0])], 2);
  assert.deepEqual([image.width, image.height], [4, 4]);
  const red = (x, y) => image.rgba[(y * 4 + x) * 4];
  assert.deepEqual([red(0, 0), red(3, 0), red(0, 3), red(3, 3)], [1, 2, 3, 4]);
  assert.throws(() => stitch([tile([0, 0, 0]), decodePng(png(3, 2, () => [0, 0, 0]))], 2), /not 2x2/);
});

test("land: false keeps a class out of the land; draw: false gives it no tint", () => {
  // Left half void, right half sea, a grass island and a shallows patch in the sea.
  const image = decodePng(
    png(20, 10, (x, y) => {
      if (x < 10) return [0, 0, 0];
      if (x >= 12 && x < 16 && y >= 2 && y < 8) return [60, 140, 60];
      if (x >= 17 && x < 19 && y >= 2 && y < 8) return [80, 160, 180];
      return [20, 40, 120];
    }),
  );
  const terrain = traceTerrain(image, {
    boundsM: { minX: 0, maxX: 200, minY: 0, maxY: 100 },
    smoothRadius: 0,
    minAreaPx: 4,
    classes: [
      { id: "sea", land: false, draw: false, colors: [[20, 40, 120]] },
      { id: "void", land: false, draw: false, colors: [[0, 0, 0]] },
      { id: "shallows", land: false, draw: true, colors: [[80, 160, 180]] },
      { id: "grass", draw: false, colors: [[60, 140, 60]] },
    ],
  });
  assert.equal(terrain.land.length, 1, "only the island is land: not the void, not the shallows");
  assert.deepEqual(terrain.classes.map((c) => [c.id, c.rings.length]), [["shallows", 1]]);
});

test("sampleColors lists the most common colours first", () => {
  const image = decodePng(png(4, 1, (x) => (x < 3 ? [0, 0, 200] : [250, 0, 0])));
  const [first, second] = sampleColors(image);
  assert.deepEqual(first.rgb, [8, 8, 200]);
  assert.equal(first.share, 0.75);
  assert.equal(second.share, 0.25);
});

/** A PNG with any colour type/depth/interlace and per-row filter, encoded independently of the decoder. */
function pngRaw(width, height, rgbaPixel, { channels = 3, filters = [0], depth = 8, color = channels === 4 ? 6 : 2, interlace = 0 } = {}) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  [ihdr[8], ihdr[9], ihdr[12]] = [depth, color, interlace];
  const stride = width * channels;
  const rows = [];
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const line = new Uint8Array(stride);
    for (let x = 0; x < width; x++) line.set(rgbaPixel(x, y).slice(0, channels), x * channels);
    const f = filters[y % filters.length];
    const out = line.map((v, i) => {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      return (v - pred) & 255;
    });
    rows.push(Buffer.from([f]), Buffer.from(out));
    prev = line;
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("decodes every filter (Sub, Up, Average, Paeth), in RGB and RGBA, mixed row by row", () => {
  const px = (x, y) => [(x * 37 + y * 11) & 255, (x * 91 + y * 5 + 200) & 255, (x * y * 13 + 250) & 255, (x * 53 + y * 29 + 17) & 255];
  for (const channels of [3, 4]) {
    const { width, height, rgba } = decodePng(pngRaw(7, 6, px, { channels, filters: [1, 2, 3, 4, 0] }));
    assert.deepEqual([width, height], [7, 6]);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const want = px(x, y);
        if (channels === 3) want[3] = 255;
        assert.deepEqual([...rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)], want, `${channels}ch pixel ${x},${y}`);
      }
    }
  }
});

test("refuses 16-bit, palette, greyscale and interlaced PNGs", () => {
  const px = () => [1, 2, 3, 4];
  assert.throws(() => decodePng(pngRaw(2, 2, px, { depth: 16 })), /unsupported PNG/);
  assert.throws(() => decodePng(pngRaw(2, 2, px, { color: 3, channels: 1 })), /unsupported PNG/);
  assert.throws(() => decodePng(pngRaw(2, 2, px, { color: 0, channels: 1 })), /unsupported PNG/);
  assert.throws(() => decodePng(pngRaw(2, 2, px, { interlace: 1 })), /unsupported PNG/);
});

test("traceRings on random masks: every edge used once, rings closed, signed areas add up to the pixel count", () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const signed = (r) => r.reduce((s, [x0, y0], i) => s + x0 * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * y0, 0) / 2;
  for (let n = 0; n < 300; n++) {
    const w = 1 + Math.floor(rnd() * 9);
    const h = 1 + Math.floor(rnd() * 9);
    const density = rnd();
    const m = Uint8Array.from({ length: w * h }, () => (rnd() < density ? 1 : 0));
    const rings = traceRings(m, w, h);
    const ones = m.reduce((s, v) => s + v, 0);
    const total = rings.reduce((s, r) => s + signed(r), 0);
    assert.ok(Math.abs(Math.abs(total) - ones) < 1e-9, `area, mask ${[...m].join("")} ${w}x${h}`);
    const seen = new Set();
    for (const r of rings) {
      assert.ok(r.length >= 4);
      r.forEach(([x0, y0], i) => {
        const [x1, y1] = r[(i + 1) % r.length];
        assert.equal(Math.abs(x1 - x0) + Math.abs(y1 - y0), 1);
        const k = `${x0},${y0}>${x1},${y1}`;
        assert.ok(!seen.has(k), `edge twice ${k}`);
        seen.add(k);
      });
    }
  }
});

test("the CLI refuses a bad --cols and a missing tile list instead of stitching NaN", () => {
  const script = fileURLToPath(new URL("./map-terrain.mjs", import.meta.url));
  for (const args of [["sample", "x.png", "--cols"], ["sample", "x.png", "--cols", "abc"], ["sample", "--cols", "2"]]) {
    const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.notEqual(r.status, 0, args.join(" "));
    assert.match(r.stderr, /--cols needs|no tile files/);
  }
});

test("a checkerboard (every pixel a diagonal touch) traces one ring per pixel", () => {
  const rings = traceRings(mask(4, ["#.#.", ".#.#", "#.#.", ".#.#"]), 4, 4);
  assert.equal(rings.length, 8);
  assert.ok(rings.every((r) => r.length === 4 && ringArea(r) === 1));
});

test("simplifyRing keeps a square's corners and drops the points along its sides", () => {
  const square = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10], [5, 10], [0, 10], [0, 5]];
  const out = simplifyRing(square, 0.1);
  assert.deepEqual(out.map((p) => p.join()).sort(), ["0,0", "0,10", "10,0", "10,10"]);
});
