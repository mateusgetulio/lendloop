export type Purpose =
  | "notify"
  | "notification-result"
  | "overdue-fetch"
  | "reminder-result"
  | "failure-report";
export class RequestError extends Error {
  status: number;
  constructor(status: number, message = "Request rejected") {
    super(message);
    this.status = status;
  }
}
const encoder = new TextEncoder();
export async function sign(
  payload: unknown,
  purpose: Purpose,
  secret: string,
  now = Date.now(),
) {
  const text = JSON.stringify(payload),
    timestamp = String(Math.floor(now / 1000));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`v1\n${timestamp}\n${purpose}\n${text}`),
    ),
  );
  return {
    body: JSON.stringify({ payload: text }),
    headers: {
      "Content-Type": "application/json",
      "X-LendLoop-Timestamp": timestamp,
      "X-LendLoop-Signature":
        "v1=" +
        Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
    },
  };
}
export async function verify(
  request: Request,
  purpose: Purpose,
  secret: string,
  now = Date.now(),
): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 65536))
    throw new RequestError(Number(declared) > 65536 ? 413 : 400);
  const reader = request.body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) {
        await reader.cancel();
        throw new RequestError(413);
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw new RequestError(400);
  }
  const outer = object(envelope, ["payload"]);
  if (typeof outer.payload !== "string") throw new RequestError(400);
  const timestamp = request.headers.get("X-LendLoop-Timestamp") ?? "",
    signature = request.headers.get("X-LendLoop-Signature") ?? "";
  if (
    !/^(0|[1-9]\d{0,12})$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    !/^v1=[a-f0-9]{64}$/.test(signature)
  )
    throw new RequestError(401);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signatureBytes = Uint8Array.from(
    signature.slice(3).match(/../g)!,
    (h) => parseInt(h, 16),
  );
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      encoder.encode(`v1\n${timestamp}\n${purpose}\n${outer.payload}`),
    ))
  )
    throw new RequestError(401);
  try {
    return JSON.parse(outer.payload);
  } catch {
    throw new RequestError(400);
  }
}
export function object(input: unknown, keys: string[]) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new RequestError(400);
  const result = input as Record<string, unknown>;
  if (
    Object.keys(result).some((k) => !keys.includes(k)) ||
    keys.some((k) => !(k in result))
  )
    throw new RequestError(400);
  return result;
}
export function text(input: unknown, max = 500) {
  if (typeof input !== "string" || !input.length || input.length > max)
    throw new RequestError(400);
  return input;
}
