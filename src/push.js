const encoder = new TextEncoder();

export function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function toBase64Url(input) {
  const bytes = new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

const extract = (salt, material) => hmac(salt, material);

async function expand(prk, info, length) {
  const block = await hmac(prk, concat(info, new Uint8Array([1])));
  return block.slice(0, length);
}

export async function importSenderKeys(privateKey, publicKey) {
  const raw = fromBase64Url(publicKey);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: toBase64Url(raw.slice(1, 33)),
    y: toBase64Url(raw.slice(33, 65)),
    d: privateKey,
    ext: true
  };
  return {
    privateKey: await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]),
    publicRaw: raw
  };
}

export async function encryptPayload(plaintext, clientPublicKey, clientAuth, options = {}) {
  const clientPublic = fromBase64Url(clientPublicKey);
  const auth = fromBase64Url(clientAuth);
  const salt = options.salt || crypto.getRandomValues(new Uint8Array(16));
  const recordSize = options.recordSize || 4096;

  let senderPrivate;
  let senderPublic;
  if (options.senderKeys) {
    senderPrivate = options.senderKeys.privateKey;
    senderPublic = options.senderKeys.publicRaw;
  } else {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    senderPrivate = pair.privateKey;
    senderPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }

  const receiver = await crypto.subtle.importKey("raw", clientPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: receiver }, senderPrivate, 256));

  const material = await extract(auth, shared);
  const keyInfo = concat(encoder.encode("WebPush: info"), new Uint8Array([0]), clientPublic, senderPublic);
  const inputKeyingMaterial = await expand(material, keyInfo, 32);
  const prk = await extract(salt, inputKeyingMaterial);

  const contentKey = await expand(prk, concat(encoder.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await expand(prk, concat(encoder.encode("Content-Encoding: nonce"), new Uint8Array([0])), 12);

  const key = await crypto.subtle.importKey("raw", contentKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const padded = concat(encoder.encode(plaintext), new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, padded));

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize);
  header[20] = senderPublic.length;
  return concat(header, senderPublic, ciphertext);
}

export async function vapidHeader(endpoint, keys, subject) {
  const audience = new URL(endpoint).origin;
  const header = toBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = toBase64Url(
    encoder.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 43200, sub: subject }))
  );
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(unsigned))
  );
  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}

export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: toBase64Url(raw), privateJwk: jwk };
}

export async function sendPush(subscription, payload, keys, subject) {
  const body = await encryptPayload(payload, subscription.p256dh, subscription.auth);
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidHeader(subscription.endpoint, keys, subject),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "86400",
      urgency: "normal"
    },
    body
  });
  return response.status;
}

export async function loadKeys(env) {
  const existing = await env.DB.prepare("SELECT public_key, private_jwk, subject FROM push_keys WHERE id = 1").first();
  if (existing) return { publicKey: existing.public_key, privateJwk: JSON.parse(existing.private_jwk), subject: existing.subject };
  const keys = await generateVapidKeys();
  await env.DB.prepare("INSERT INTO push_keys (id, public_key, private_jwk, created_at) VALUES (1, ?1, ?2, ?3) ON CONFLICT(id) DO NOTHING")
    .bind(keys.publicKey, JSON.stringify(keys.privateJwk), Date.now())
    .run();
  const stored = await env.DB.prepare("SELECT public_key, private_jwk, subject FROM push_keys WHERE id = 1").first();
  return { publicKey: stored.public_key, privateJwk: JSON.parse(stored.private_jwk), subject: stored.subject };
}

export async function notifySubscribers(env, messages, subject) {
  if (messages.length === 0) return 0;
  const result = await env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions LIMIT 20").all();
  const subscriptions = result.results || [];
  if (subscriptions.length === 0) return 0;
  const keys = await loadKeys(env);
  const sender = keys.subject || subject || "https://rssreader.invalid";
  const stale = [];
  let sent = 0;
  for (const subscription of subscriptions) {
    for (const message of messages) {
      let status = 0;
      try {
        status = await sendPush(subscription, JSON.stringify(message), keys, sender);
      } catch {
        status = 0;
      }
      if (status === 404 || status === 410) {
        stale.push(subscription.endpoint);
        break;
      }
      if (status >= 200 && status < 300) sent += 1;
    }
  }
  if (stale.length > 0) {
    await env.DB.batch(stale.map((endpoint) => env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?1").bind(endpoint)));
  }
  return sent;
}
