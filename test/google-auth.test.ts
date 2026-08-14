import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildAssertionJwt, loadServiceAccountKey, type ServiceAccountKey } from "../src/google-auth.ts";

function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

function testKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return { privateKey: privateKey as string, publicKey: publicKey as string };
}

describe("buildAssertionJwt", () => {
  test("produces a header.claims.signature JWT with correct header and claims", () => {
    const { privateKey } = testKeyPair();
    const key: ServiceAccountKey = { client_email: "bot@project.iam.gserviceaccount.com", private_key: privateKey };
    const now = new Date(2026, 0, 1, 12, 0, 0);

    const jwt = buildAssertionJwt(key, "https://www.googleapis.com/auth/spreadsheets", now);
    const [headerB64, claimsB64, sigB64] = jwt.split(".");
    expect(headerB64).toBeDefined();
    expect(claimsB64).toBeDefined();
    expect(sigB64).toBeDefined();

    const header = JSON.parse(base64urlDecode(headerB64!).toString());
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });

    const claims = JSON.parse(base64urlDecode(claimsB64!).toString());
    expect(claims.iss).toBe("bot@project.iam.gserviceaccount.com");
    expect(claims.scope).toBe("https://www.googleapis.com/auth/spreadsheets");
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
    expect(claims.iat).toBe(Math.floor(now.getTime() / 1000));
    expect(claims.exp).toBe(claims.iat + 3600);
  });

  test("the signature actually verifies against the key's public key", () => {
    const { privateKey, publicKey } = testKeyPair();
    const key: ServiceAccountKey = { client_email: "bot@project.iam.gserviceaccount.com", private_key: privateKey };

    const jwt = buildAssertionJwt(key, "scope", new Date());
    const [headerB64, claimsB64, sigB64] = jwt.split(".");
    const signingInput = `${headerB64}.${claimsB64}`;

    const verifier = createVerify("RSA-SHA256");
    verifier.update(signingInput);
    verifier.end();
    expect(verifier.verify(publicKey, base64urlDecode(sigB64!))).toBe(true);
  });

  test("respects a custom token_uri as the audience", () => {
    const { privateKey } = testKeyPair();
    const key: ServiceAccountKey = {
      client_email: "bot@project.iam.gserviceaccount.com",
      private_key: privateKey,
      token_uri: "https://example.com/custom-token-endpoint",
    };
    const jwt = buildAssertionJwt(key, "scope", new Date());
    const claims = JSON.parse(base64urlDecode(jwt.split(".")[1]!).toString());
    expect(claims.aud).toBe("https://example.com/custom-token-endpoint");
  });

  test("a tampered claims segment fails signature verification (sanity check)", () => {
    const { privateKey, publicKey } = testKeyPair();
    const key: ServiceAccountKey = { client_email: "bot@project.iam.gserviceaccount.com", private_key: privateKey };
    const jwt = buildAssertionJwt(key, "scope", new Date());
    const [headerB64, , sigB64] = jwt.split(".");

    const tamperedClaims = Buffer.from(JSON.stringify({ iss: "attacker@evil.com" })).toString("base64url");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${headerB64}.${tamperedClaims}`);
    verifier.end();
    expect(verifier.verify(publicKey, base64urlDecode(sigB64!))).toBe(false);
  });
});

describe("loadServiceAccountKey", () => {
  test("loads and parses a key file at an absolute path", () => {
    const dir = mkdtempSync(join(tmpdir(), "safar-key-test-"));
    const path = join(dir, "key.json");
    writeFileSync(path, JSON.stringify({ client_email: "bot@x.iam.gserviceaccount.com", private_key: "PEM" }));
    const key = loadServiceAccountKey(path);
    expect(key.client_email).toBe("bot@x.iam.gserviceaccount.com");
    rmSync(dir, { recursive: true, force: true });
  });

  test("expands a leading ~ to the home directory", () => {
    const marker = `safar-test-key-${Date.now()}.json`;
    const realPath = join(homedir(), marker);
    writeFileSync(realPath, JSON.stringify({ client_email: "bot@x.iam.gserviceaccount.com", private_key: "PEM" }));
    try {
      const key = loadServiceAccountKey(`~/${marker}`);
      expect(key.client_email).toBe("bot@x.iam.gserviceaccount.com");
    } finally {
      rmSync(realPath, { force: true });
    }
  });

  test("throws a clear error when the file doesn't look like a service account key", () => {
    const dir = mkdtempSync(join(tmpdir(), "safar-key-test-"));
    const path = join(dir, "not-a-key.json");
    writeFileSync(path, JSON.stringify({ foo: "bar" }));
    expect(() => loadServiceAccountKey(path)).toThrow(/service account key/);
    rmSync(dir, { recursive: true, force: true });
  });
});
