import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
export function encrypt(value: unknown, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function decrypt(value: string, key: string): unknown {
  const [iv, tag, ciphertext] = value.split(".");
  if (!iv || !tag || !ciphertext)
    throw new Error("Invalid encrypted credentials.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString(),
  );
}
export function signature(value: string, key: string) {
  return createHmac("sha256", Buffer.from(key, "hex"))
    .update(value)
    .digest("hex");
}
export function verifySignature(value: string, signed: string, key: string) {
  const expected = Buffer.from(signature(value, key));
  const received = Buffer.from(signed);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
