import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
// Temporary signing probes on the integration routes. No database writes or product behavior.
const http = httpRouter();
function probe(purpose: string) {
  return httpAction(async (_ctx, request) => {
    const declared = request.headers.get("content-length");
    if (declared && Number(declared) > 65536)
      return new Response(null, { status: 413 });
    const body = await request.text();
    if (new TextEncoder().encode(body).length > 65536)
      return new Response(null, { status: 413 });
    let envelope;
    try {
      envelope = JSON.parse(body);
    } catch {
      return new Response(null, { status: 400 });
    }
    if (
      !envelope ||
      Object.keys(envelope).length !== 1 ||
      typeof envelope.payload !== "string"
    )
      return new Response(null, { status: 400 });
    const timestamp = request.headers.get("X-LendLoop-Timestamp") ?? "";
    const signature = request.headers.get("X-LendLoop-Signature") ?? "";
    if (
      !/^\d+$/.test(timestamp) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
      !/^v1=[a-f0-9]{64}$/.test(signature)
    )
      return new Response(null, { status: 401 });
    const secret = process.env.N8N_TO_CONVEX_SECRET;
    if (!secret) return new Response(null, { status: 503 });
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const bytes = Uint8Array.from(signature.slice(3).match(/../g)!, (hex) =>
      parseInt(hex, 16),
    );
    const verified = await crypto.subtle.verify(
      "HMAC",
      key,
      bytes,
      encoder.encode(`v1\n${timestamp}\n${purpose}\n${envelope.payload}`),
    );
    if (!verified) return new Response(null, { status: 401 });
    let payload;
    try {
      payload = JSON.parse(envelope.payload);
    } catch {
      return new Response(null, { status: 400 });
    }
    if (payload?.spike !== true) return new Response(null, { status: 400 });
    console.log(`M1 verified ${purpose}`);
    return Response.json({ verified: true, purpose, ...payload });
  });
}
http.route({
  path: "/automation/notifications",
  method: "POST",
  handler: probe("notification-result"),
});
http.route({
  path: "/automation/failures",
  method: "POST",
  handler: probe("failure-report"),
});
export default http;
