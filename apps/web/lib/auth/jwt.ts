import { SignJWT, jwtVerify } from "jose";

const ACCESS_TOKEN_TTL = "15m";
const ISSUER = "home-expenses";

function getSecret(name: "JWT_SECRET" | "JWT_REFRESH_SECRET"): Uint8Array {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return new TextEncoder().encode(value);
}

export interface AccessTokenClaims {
  userId: string;
}

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({ userId } satisfies AccessTokenClaims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(getSecret("JWT_SECRET"));
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, getSecret("JWT_SECRET"), { issuer: ISSUER });
  const userId = payload.userId;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("Access token is missing a userId claim");
  }
  return { userId };
}
