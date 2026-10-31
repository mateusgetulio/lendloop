import { internalAction } from "./_generated/server";

// Temporary action: proves the backend itself can reach Docker n8n.
export const roundTrip = internalAction({
  args: {},
  handler: async () => {
    const secret = process.env.CONVEX_TO_N8N_SECRET;
    const url = process.env.N8N_NOTIFY_URL;
    if (!secret || !url) throw new Error("Missing round-trip environment");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = JSON.stringify({
      spike: true,
      message: "Neighborhood café tool\nsecond line",
    });
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signed = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(`v1\n${timestamp}\nnotify\n${payload}`),
      ),
    );
    const signature =
      "v1=" +
      Array.from(signed, (b) => b.toString(16).padStart(2, "0")).join("");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LendLoop-Timestamp": timestamp,
        "X-LendLoop-Signature": signature,
      },
      body: JSON.stringify({ payload }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(`Round trip failed: HTTP ${response.status}`);
    return await response.json();
  },
});
