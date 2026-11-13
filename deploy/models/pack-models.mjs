// Packs licensed animal models into the viewer's own encrypted format (.blgm) at publish time.
//
// The models are paid assets (CGTrader Royalty Free licence): they may only be used built into a product,
// and software must take reasonable measures to stop users extracting them. So the portal never serves the
// source files. This script takes one of each pack's own lower-detail meshes, turns it to the viewer's frame,
// quantizes it, shrinks its colour texture, and encrypts the result with AES-256-GCM under a key that is
// compiled into the viewer build (a new key on every publish). The source folder and the output stay out of
// every repository.
//
//   node pack-models.mjs --src ~/Projects/whoi-mpg/models/cgtrader --out <dir> --key <64 hex chars> [--preview]
//
// Output: <out>/<name>.blgm for each model found, and <out>/models.json mapping species to model.

import { createCipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import sharp from "sharp";

/** Which source file and mesh to use per model, the species it stands for, and a typical adult length. */
const MODELS = {
  swordfish: {
    file: "Swordfish_Clear_Patched.glb",
    mesh: "Plane.002", // the pack's LOD2, about 6000 triangles
    species: ["xiphias gladius"],
    length_m: 2.5,
  },
  whale_shark: {
    file: "Whale_Shark_Clear_Patched.glb",
    mesh: "Plane.003", // LOD3, about 3700 triangles
    species: ["rhincodon typus"],
    length_m: 8,
  },
};
const TEXTURE_PX = 512;
const FORMAT_VERSION = 1;

function args() {
  const a = process.argv.slice(2);
  const get = (k) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const src = get("--src");
  const out = get("--out");
  const key = get("--key") ?? process.env.MODEL_KEY;
  if (!src || !out || !key || !/^[0-9a-f]{64}$/i.test(key)) {
    console.error("usage: node pack-models.mjs --src DIR --out DIR --key <64 hex chars> [--preview]");
    process.exit(2);
  }
  return { src, out, key: Buffer.from(key, "hex"), preview: a.includes("--preview") };
}

/**
 * Turn the mesh so the head points along -z and the back along +y (three.js, north at heading 0), centred on its
 * bounding box and scaled to unit length. The long axis is the one with the largest extent; the head is the end
 * whose last tenth is slimmest across (the bill or the snout tapers more than the tail, whose fins spread).
 * The source models are y-up, as glTF requires.
 */
function orient(pos) {
  const n = pos.length / 3;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], pos[i * 3 + k]);
      hi[k] = Math.max(hi[k], pos[i * 3 + k]);
    }
  const ext = hi.map((h, k) => h - lo[k]);
  const ax = ext[0] >= ext[2] ? 0 : 2; // long axis among the horizontal ones
  const side = ax === 0 ? 2 : 0;
  const spread = (fromLow) => {
    let s = 0;
    let c = 0;
    for (let i = 0; i < n; i++) {
      const t = (pos[i * 3 + ax] - lo[ax]) / ext[ax];
      if (fromLow ? t < 0.1 : t > 0.9) {
        s += Math.abs(pos[i * 3 + 1] - (lo[1] + hi[1]) / 2) + Math.abs(pos[i * 3 + side] - (lo[side] + hi[side]) / 2);
        c++;
      }
    }
    return c ? s / c : Infinity;
  };
  const headAtLow = spread(true) < spread(false);
  const mid = lo.map((l, k) => (l + hi[k]) / 2);
  const len = ext[ax];
  // forward (toward the head) in source coordinates, mapped to -z; up stays +y; right-handed: x = y cross z.
  const f = [0, 0, 0];
  f[ax] = headAtLow ? -1 : 1;
  const z = f.map((v) => -v); // the viewer's +z, pointing to the tail
  const x = [1 * z[2] - 0 * z[1], 0 * z[0] - 0 * z[2], 0 * z[1] - 1 * z[0]]; // y cross z with y = (0, 1, 0)
  const map = (v, translate) => {
    const d = translate ? [v[0] - mid[0], v[1] - mid[1], v[2] - mid[2]] : v;
    const s = translate ? 1 / len : 1;
    return [
      (d[0] * x[0] + d[1] * x[1] + d[2] * x[2]) * s,
      d[1] * s,
      (d[0] * z[0] + d[1] * z[1] + d[2] * z[2]) * s,
    ];
  };
  return { map, info: { axis: "xyz"[ax], headAtLow, length_src: len } };
}

function quantize(values, comps, type) {
  const n = values.length / comps;
  const lo = Array(comps).fill(Infinity);
  const hi = Array(comps).fill(-Infinity);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < comps; k++) {
      lo[k] = Math.min(lo[k], values[i * comps + k]);
      hi[k] = Math.max(hi[k], values[i * comps + k]);
    }
  const max = type === "u16" ? 65535 : 32767;
  const out = type === "u16" ? new Uint16Array(n * comps) : new Int16Array(n * comps);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < comps; k++) {
      const span = hi[k] - lo[k] || 1;
      const t = (values[i * comps + k] - lo[k]) / span;
      out[i * comps + k] = type === "u16" ? Math.round(t * max) : Math.round(t * 2 * max - max);
    }
  return { data: out, lo, hi };
}

async function pack(name, spec, src, key) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(join(src, spec.file));
  const mesh = doc.getRoot().listMeshes().find((m) => m.getName() === spec.mesh);
  if (!mesh) throw new Error(`${spec.file}: no mesh named ${spec.mesh}`);
  const prim = mesh.listPrimitives()[0];
  const srcPos = prim.getAttribute("POSITION").getArray();
  const srcNrm = prim.getAttribute("NORMAL").getArray();
  const uv = prim.getAttribute("TEXCOORD_0").getArray();
  const idx = prim.getIndices().getArray();
  const n = srcPos.length / 3;
  const { map, info } = orient(srcPos);
  const pos = new Float32Array(n * 3);
  const nrm = new Int8Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos.set(map([srcPos[i * 3], srcPos[i * 3 + 1], srcPos[i * 3 + 2]], true), i * 3);
    const v = map([srcNrm[i * 3], srcNrm[i * 3 + 1], srcNrm[i * 3 + 2]], false);
    const l = Math.hypot(...v) || 1;
    for (let k = 0; k < 3; k++) nrm[i * 3 + k] = Math.round((v[k] / l) * 127);
  }
  const qp = quantize(pos, 3, "i16");
  const qu = quantize(uv, 2, "u16");
  const index = n < 65536 ? Uint16Array.from(idx) : Uint32Array.from(idx);

  const albedo = prim.getMaterial()?.getBaseColorTexture();
  const image = albedo
    ? await sharp(Buffer.from(albedo.getImage())).resize(TEXTURE_PX, TEXTURE_PX).removeAlpha().webp({ quality: 80 }).toBuffer() // opaque fish
    : Buffer.alloc(0);

  const parts = [qp.data, nrm, qu.data, index, image];
  const offsets = [];
  let at = 0;
  for (const p of parts) {
    offsets.push(at);
    at += p.byteLength;
    at = (at + 3) & ~3; // keep every typed array 4-byte aligned
  }
  const header = {
    name,
    vertices: n,
    indices: index.length,
    index_type: index instanceof Uint16Array ? "u16" : "u32",
    position: { lo: qp.lo, hi: qp.hi },
    uv: { lo: qu.lo, hi: qu.hi },
    texture: image.byteLength ? "image/webp" : null,
    length_m: spec.length_m,
    offsets: { position: offsets[0], normal: offsets[1], uv: offsets[2], index: offsets[3], texture: offsets[4] },
    texture_bytes: image.byteLength,
  };
  const head = Buffer.from(JSON.stringify(header));
  const headLen = (head.length + 3) & ~3;
  const body = Buffer.alloc(4 + headLen + at);
  body.writeUInt32LE(headLen, 0);
  head.copy(body, 4);
  parts.forEach((p, k) => Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(body, 4 + headLen + offsets[k]));

  // File: "BLGM", version byte, 3 reserved, 12-byte IV, AES-256-GCM ciphertext with its 16-byte tag appended
  // (the layout WebCrypto's decrypt expects).
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const sealed = Buffer.concat([cipher.update(body), cipher.final(), cipher.getAuthTag()]);
  const file = Buffer.concat([Buffer.from("BLGM"), Buffer.from([FORMAT_VERSION, 0, 0, 0]), iv, sealed]);
  return { file, pos, idx: index, info, header };
}

/** Side and top views of the oriented mesh as a PNG, to check that the head points to -z and the back up. */
async function preview(pos, idx, path) {
  const W = 900;
  const view = (u, v, oy) => {
    let d = "";
    for (let t = 0; t < idx.length; t += 3) {
      const p = [idx[t], idx[t + 1], idx[t + 2]].map((i) => [(pos[i * 3 + u] + 0.55) * W * 0.9, oy - pos[i * 3 + v] * W * 0.9]);
      d += `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}L${p[1][0].toFixed(1)},${p[1][1].toFixed(1)}L${p[2][0].toFixed(1)},${p[2][1].toFixed(1)}Z`;
    }
    return `<path d="${d}" fill="none" stroke="#335" stroke-width="0.3"/>`;
  };
  // side: z to the right (head left), y up; top: z to the right, x down
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}"><rect width="100%" height="100%" fill="#fff"/>
    <text x="10" y="20" font-size="16">side (head should be left, back up)</text>${view(2, 1, W * 0.28)}
    <text x="10" y="${W * 0.55}" font-size="16">top (head left; +x down)</text>${view(2, 0, W * 0.78)}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path);
}

const { src, out, key, preview: wantPreview } = args();
mkdirSync(out, { recursive: true });
const manifest = { version: FORMAT_VERSION, models: {} };
for (const [name, spec] of Object.entries(MODELS)) {
  if (!existsSync(join(src, spec.file))) {
    console.log(`skip ${name}: ${spec.file} not in ${src}`);
    continue;
  }
  const r = await pack(name, spec, src, key);
  writeFileSync(join(out, `${name}.blgm`), r.file);
  manifest.models[name] = { file: `${name}.blgm`, species: spec.species, length_m: spec.length_m };
  console.log(`packed ${name}: ${r.header.vertices} vertices, ${r.header.indices / 3} triangles, ${(r.file.length / 1024).toFixed(0)} KiB (long axis ${r.info.axis}, head at ${r.info.headAtLow ? "low" : "high"} end)`);
  if (wantPreview) await preview(r.pos, r.idx, join(out, `${name}-preview.png`));
}
writeFileSync(join(out, "models.json"), JSON.stringify(manifest, null, 2) + "\n");
