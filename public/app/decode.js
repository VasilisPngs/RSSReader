const SNIFF_BYTES = 2048;

export function charsetFromContentType(contentType) {
  const match = /charset\s*=\s*"?([\w-]+)/i.exec(contentType || "");
  return match ? match[1] : null;
}

export function charsetFromBody(head) {
  const meta = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head);
  if (meta) return meta[1];
  const declaration = /<\?xml[^>]+encoding\s*=\s*["']([\w-]+)["']/i.exec(head);
  return declaration ? declaration[1] : null;
}

export function decodeBody(buffer, contentType) {
  const bytes = new Uint8Array(buffer);
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, SNIFF_BYTES));
  const label = charsetFromContentType(contentType) || charsetFromBody(head) || "utf-8";
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
