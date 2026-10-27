import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { classify, decodePng, majority, ringArea, sampleColors, simplifyRing, traceRings, traceTerrain } from "./map-terrain.mjs";

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

test("sampleColors lists the most common colours first", () => {
  const image = decodePng(png(4, 1, (x) => (x < 3 ? [0, 0, 200] : [250, 0, 0])));
  const [first, second] = sampleColors(image);
  assert.deepEqual(first.rgb, [8, 8, 200]);
  assert.equal(first.share, 0.75);
  assert.equal(second.share, 0.25);
});
