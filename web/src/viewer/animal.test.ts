import { describe, expect, it } from "vitest";
import { decryptAesGcm, unpackModel } from "./animal";

const KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

/** A one-triangle packed model in the layout deploy/models/pack-models.mjs writes (no texture). */
async function packed(version = 1, key = KEY): Promise<ArrayBuffer> {
  const pos = new Int16Array([-32767, -32767, -32767, 32767, -32767, 0, 0, 32767, 32767]);
  const nrm = new Int8Array([0, 127, 0, 0, 127, 0, 0, 127, 0]);
  const uv = new Uint16Array([0, 0, 65535, 0, 0, 65535]);
  const idx = new Uint16Array([0, 1, 2]);
  const parts = [pos, nrm, uv, idx];
  const offsets: number[] = [];
  let at = 0;
  for (const p of parts) {
    offsets.push(at);
    at = (at + p.byteLength + 3) & ~3;
  }
  const header = {
    name: "test",
    vertices: 3,
    indices: 3,
    index_type: "u16",
    position: { lo: [-0.5, -0.1, -0.5], hi: [0.5, 0.1, 0.5] },
    uv: { lo: [0, 0], hi: [1, 1] },
    texture: null,
    texture_bytes: 0,
    length_m: 2.5,
    offsets: { position: offsets[0], normal: offsets[1], uv: offsets[2], index: offsets[3], texture: at },
  };
  const head = new TextEncoder().encode(JSON.stringify(header));
  const headLen = (head.length + 3) & ~3;
  const body = new Uint8Array(4 + headLen + at);
  new DataView(body.buffer).setUint32(0, headLen, true);
  body.set(head, 4);
  parts.forEach((p, k) => body.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), 4 + headLen + offsets[k]!));
  const raw = new Uint8Array(key.match(/../g)!.map((h) => parseInt(h, 16)));
  const ck = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = new Uint8Array(12).fill(7);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, ck, body));
  const file = new Uint8Array(20 + sealed.length);
  file.set(new TextEncoder().encode("BLGM"), 0);
  file[4] = version;
  file.set(iv, 8);
  file.set(sealed, 20);
  return file.buffer;
}

describe("unpackModel", () => {
  it("decrypts and rebuilds the geometry", async () => {
    const m = await unpackModel(await packed(), KEY);
    expect(m.name).toBe("test");
    expect(m.length_m).toBe(2.5);
    expect(m.texture).toBeNull();
    const p = m.geometry.getAttribute("position");
    expect(p.count).toBe(3);
    expect([p.getX(0), p.getY(0), p.getZ(0)].map((v) => +v.toFixed(4))).toEqual([-0.5, -0.1, -0.5]);
    expect([p.getX(2), p.getY(2), p.getZ(2)].map((v) => +v.toFixed(4))).toEqual([0, 0.1, 0.5]);
    expect(m.geometry.getAttribute("uv").getX(1)).toBeCloseTo(1);
    expect(Array.from(m.geometry.getIndex()!.array)).toEqual([0, 1, 2]);
  });

  it("decrypts without WebCrypto, as on the hub read over plain http", async () => {
    const m = await unpackModel(await packed(), KEY, null);
    expect(m.name).toBe("test");
    expect(Array.from(m.geometry.getIndex()!.array)).toEqual([0, 1, 2]);
    await expect(unpackModel(await packed(1, KEY.replace(/^00/, "ff")), KEY, null)).rejects.toThrow();
  });

  it("gives the same plaintext on both decryption paths", async () => {
    const key = new Uint8Array(32).fill(3);
    const iv = new Uint8Array(12).fill(9);
    const ck = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, ck, new TextEncoder().encode("swordfish")));
    const viaSubtle = await decryptAesGcm(key, iv, sealed, crypto.subtle);
    const viaNoble = await decryptAesGcm(key, iv, sealed, null);
    expect(new TextDecoder().decode(viaNoble)).toBe("swordfish");
    expect(new Uint8Array(viaNoble)).toEqual(new Uint8Array(viaSubtle));
  });

  it("refuses a wrong key, an unknown version and a file that is not a packed model", async () => {
    await expect(unpackModel(await packed(1, KEY.replace(/^00/, "ff")), KEY)).rejects.toThrow();
    await expect(unpackModel(await packed(2), KEY)).rejects.toThrow(/version 2/);
    await expect(unpackModel(new Uint8Array(32).buffer, KEY)).rejects.toThrow(/not a packed model/);
  });
});
