import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function expandTilde(path: string): string {
  return path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
}

export function loadServiceAccountKey(path: string): ServiceAccountKey {
  const raw = readFileSync(expandTilde(path), "utf-8");
  const parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(`${path} doesn't look like a service account key (missing client_email/private_key)`);
  }
  return parsed;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Builds the RS256 JWT assertion for Google's "OAuth 2.0 for Server to
 * Server Applications" flow (service accounts) — pure and synchronous so
 * it's testable without a network call. `now` is injectable for
 * deterministic tests.
 */
export function buildAssertionJwt(
  key: ServiceAccountKey,
  scope: string,
  now: Date = new Date(),
): string {
  const header = { alg: "RS256", typ: "JWT" };
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + 3600; // Google caps this at 1h regardless
  const claims = {
    iss: key.client_email,
    scope,
    aud: key.token_uri ?? DEFAULT_TOKEN_URI,
    iat,
    exp,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = base64url(signer.sign(key.private_key));

  return `${signingInput}.${signature}`;
}

/** Trades a signed JWT assertion for a short-lived (1h) access token. */
export async function exchangeJwtForToken(jwt: string, tokenUri: string): Promise<string> {
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export async function getAccessToken(
  key: ServiceAccountKey,
  scope: string,
  now: Date = new Date(),
): Promise<string> {
  const jwt = buildAssertionJwt(key, scope, now);
  return exchangeJwtForToken(jwt, key.token_uri ?? DEFAULT_TOKEN_URI);
}
