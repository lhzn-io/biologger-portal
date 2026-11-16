import { describe, expect, it } from "vitest";
import { parseVisit, retentionCutoff, verifyAccessToken, type AccessCerts } from "./visits";

const NOW = new Date("2026-11-15T12:00:00.250Z");

describe("visit beacons", () => {
  it("records a page view with the Access email and country, and nothing else", () => {
    const row = parseVisit({ kind: "page", path: "/deployments/X/track/R?color=depth" }, "Cam@WHOI.edu", "US", NOW);
    expect(row).toEqual({
      at_utc: "2026-11-15T12:00:00Z",
      email: "cam@whoi.edu",
      country: "US",
      kind: "page",
      path: "/deployments/X/track/R?color=depth",
      action: "",
      detail: "{}",
    });
  });

  it("records an allowed action with a small flat detail", () => {
    const row = parseVisit({ kind: "action", path: "/", action: "play", detail: { speed: 60, camera: "chase" } }, "a@b.org", null, NOW);
    expect(row).not.toBe("bad");
    expect((row as { detail: string }).detail).toBe('{"speed":60,"camera":"chase"}');
  });

  it("writes nothing without an Access email", () => {
    expect(parseVisit({ kind: "page", path: "/" }, null, "US", NOW)).toBe("skip");
  });

  it.each([
    [{ kind: "page" }],
    [{ kind: "click", path: "/" }],
    [{ kind: "page", path: "https://elsewhere/" }],
    [{ kind: "page", path: "/" + "x".repeat(600) }],
    [{ kind: "action", path: "/", action: "rm -rf" }],
    [{ kind: "page", path: "/", action: "play" }],
    [{ kind: "action", path: "/", action: "play", detail: { nested: { a: 1 } } }],
    [{ kind: "action", path: "/", action: "play", detail: [1, 2] }],
    [["page"]],
  ])("refuses %j", (body) => {
    expect(parseVisit(body, "a@b.org", "US", NOW)).toBe("bad");
  });

  it("keeps 180 days", () => {
    expect(retentionCutoff(NOW)).toBe("2026-05-19T12:00:00Z");
  });
});

const b64url = (bytes: Uint8Array | string) =>
  btoa(typeof bytes === "string" ? bytes : String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function signer() {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1" };
  const certs: AccessCerts = { keys: [jwk] };
  const sign = async (claims: Record<string, unknown>, kid = "k1") => {
    const h = b64url(JSON.stringify({ alg: "RS256", kid }));
    const p = b64url(JSON.stringify(claims));
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${h}.${p}`)));
    return `${h}.${p}.${b64url(sig)}`;
  };
  return { certs, sign };
}

describe("admin token check", () => {
  const team = "lab.cloudflareaccess.com";
  const good = { aud: ["admin-aud"], iss: `https://${team}`, exp: NOW.getTime() / 1000 + 600 };

  it("accepts a token for the admin application", async () => {
    const { certs, sign } = await signer();
    expect(await verifyAccessToken(await sign(good), "admin-aud", team, certs, NOW)).toBe(true);
  });

  it("refuses another application's token, an expired one, another issuer, an unknown key or a bad signature", async () => {
    const { certs, sign } = await signer();
    expect(await verifyAccessToken(await sign({ ...good, aud: ["viewer-aud"] }), "admin-aud", team, certs, NOW)).toBe(false);
    expect(await verifyAccessToken(await sign({ ...good, exp: NOW.getTime() / 1000 - 1 }), "admin-aud", team, certs, NOW)).toBe(false);
    expect(await verifyAccessToken(await sign({ ...good, iss: "https://other.cloudflareaccess.com" }), "admin-aud", team, certs, NOW)).toBe(false);
    expect(await verifyAccessToken(await sign(good, "k2"), "admin-aud", team, certs, NOW)).toBe(false);
    const t = await sign(good);
    expect(await verifyAccessToken(t.slice(0, -4) + "AAAA", "admin-aud", team, certs, NOW)).toBe(false);
    expect(await verifyAccessToken(await sign(good), "", team, certs, NOW)).toBe(false);
  });
});
