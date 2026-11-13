/**
 * Animal models for the 3D view. They come from paid packs whose licence allows them only built into the
 * product, so the publish step packs them into this viewer's own encrypted format (deploy/models/pack-models.mjs)
 * under a key compiled into the build. Without the key, the packed files, or WebCrypto (which needs https or
 * localhost), the view falls back to a plain marker.
 */
import * as THREE from "three";

const KEY_HEX: string | undefined = import.meta.env.VITE_MODEL_KEY;
const FORMAT_VERSION = 1;

export interface AnimalModel {
  name: string;
  /** Unit length along the body, head toward -z, back toward +y. */
  geometry: THREE.BufferGeometry;
  texture: THREE.Texture | null;
  /** Typical adult length (m), for drawing at true scale. */
  length_m: number;
}

interface Manifest {
  version: number;
  models: Record<string, { file: string; species: string[]; length_m: number }>;
}

interface Header {
  name: string;
  vertices: number;
  indices: number;
  index_type: "u16" | "u32";
  position: { lo: number[]; hi: number[] };
  uv: { lo: number[]; hi: number[] };
  texture: string | null;
  texture_bytes: number;
  length_m: number;
  offsets: { position: number; normal: number; uv: number; index: number; texture: number };
}

let manifest: Promise<Manifest | null> | null = null;
const cache = new Map<string, Promise<AnimalModel | null>>();

function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function dequantize(q: Int16Array | Uint16Array, comps: number, lo: number[], hi: number[], signed: boolean): Float32Array {
  const out = new Float32Array(q.length);
  const max = signed ? 32767 : 65535;
  for (let i = 0; i < q.length; i++) {
    const k = i % comps;
    const t = signed ? (q[i]! + max) / (2 * max) : q[i]! / max;
    out[i] = lo[k]! + t * (hi[k]! - lo[k]!);
  }
  return out;
}

/** Decrypt and unpack one .blgm file. Exported for tests. */
export async function unpackModel(file: ArrayBuffer, keyHex: string): Promise<AnimalModel> {
  const bytes = new Uint8Array(file);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "BLGM") throw new Error("not a packed model");
  if (bytes[4] !== FORMAT_VERSION) throw new Error(`packed model version ${bytes[4]} is not supported`);
  const key = await crypto.subtle.importKey("raw", hexBytes(keyHex), "AES-GCM", false, ["decrypt"]);
  const body = new DataView(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(8, 20) }, key, bytes.slice(20)));
  const headLen = body.getUint32(0, true);
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(body.buffer, 4, headLen)).replace(/\0+$/, "")) as Header;
  const base = 4 + headLen;
  const at = (offset: number) => body.buffer.slice(base + offset);
  const n = h.vertices;
  const geometry = new THREE.BufferGeometry();
  const pos = dequantize(new Int16Array(at(h.offsets.position), 0, n * 3), 3, h.position.lo, h.position.hi, true);
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Int8Array(at(h.offsets.normal), 0, n * 3), 3, true));
  const uv = dequantize(new Uint16Array(at(h.offsets.uv), 0, n * 2), 2, h.uv.lo, h.uv.hi, false);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  const index =
    h.index_type === "u16" ? new Uint16Array(at(h.offsets.index), 0, h.indices) : new Uint32Array(at(h.offsets.index), 0, h.indices);
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  let texture: THREE.Texture | null = null;
  if (h.texture && h.texture_bytes > 0 && typeof createImageBitmap === "function") {
    const blob = new Blob([new Uint8Array(body.buffer, base + h.offsets.texture, h.texture_bytes)], { type: h.texture });
    texture = new THREE.Texture(await createImageBitmap(blob, { imageOrientation: "none" }));
    texture.flipY = false; // glTF texture coordinates
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
  }
  return { name: h.name, geometry, texture, length_m: h.length_m };
}

/** The model for a species (scientific name), or null when there is none or it cannot be loaded here. */
export function loadAnimalModel(species: string | undefined): Promise<AnimalModel | null> {
  const key = KEY_HEX;
  if (!species || !key || typeof crypto === "undefined" || !crypto.subtle) return Promise.resolve(null);
  manifest ??= fetch("/models/models.json")
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
    .catch(() => null);
  const s = species.trim().toLowerCase();
  let p = cache.get(s);
  if (!p) {
    p = manifest.then(async (m) => {
      const entry = m && m.version === FORMAT_VERSION ? Object.values(m.models).find((e) => e.species.includes(s)) : undefined;
      if (!entry) return null;
      try {
        const r = await fetch(`/models/${entry.file}`);
        return r.ok ? await unpackModel(await r.arrayBuffer(), key) : null;
      } catch (e) {
        console.warn(`animal model for ${species} not shown:`, e);
        return null;
      }
    });
    cache.set(s, p);
  }
  return p;
}
