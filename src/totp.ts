/**
 * TOTP verifier — RFC 6238 / RFC 4226 compliant
 *
 * Designed for Cloudflare Workers (Web Crypto API only, no node:crypto).
 * - 6-digit codes, 30-second step, SHA-1 (standard authenticator app config)
 * - Constant-time comparison via crypto.subtle.timingSafeEqual to prevent timing attacks
 * - ±1 window (covers ~30s clock drift on either side)
 * - Input sanitization: strips spaces, validates exactly 6 ASCII digits
 */

// RFC 4648 Base32 alphabet
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/**
 * Decode a Base32-encoded string (RFC 4648) into a Uint8Array.
 * Throws if the input contains characters outside the alphabet.
 */
function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  // Normalize: uppercase, strip padding and whitespace
  const clean = input.toUpperCase().replace(/[=\s]/g, '')

  let bits = 0
  let value = 0
  let index = 0
  const output = new Uint8Array<ArrayBuffer>(new ArrayBuffer(Math.floor((clean.length * 5) / 8)))

  for (const char of clean) {
    const charIndex = BASE32_ALPHABET.indexOf(char)
    if (charIndex === -1) {
      throw new Error(`Invalid Base32 character: "${char}"`)
    }

    value = (value << 5) | charIndex
    bits += 5

    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 0xff
      bits -= 8
    }
  }

  return output
}

/**
 * Encode a counter (64-bit big-endian) into an 8-byte Uint8Array.
 * JavaScript numbers are safe up to 2^53, which is more than enough
 * for TOTP counters (current Unix time / 30).
 */
function counterToBytes(counter: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array<ArrayBuffer>(new ArrayBuffer(8))
  // Write as big-endian 64-bit integer (high 32 bits are always 0 for TOTP)
  const high = Math.floor(counter / 0x100000000)
  const low = counter >>> 0
  bytes[0] = (high >>> 24) & 0xff
  bytes[1] = (high >>> 16) & 0xff
  bytes[2] = (high >>> 8) & 0xff
  bytes[3] = high & 0xff
  bytes[4] = (low >>> 24) & 0xff
  bytes[5] = (low >>> 16) & 0xff
  bytes[6] = (low >>> 8) & 0xff
  bytes[7] = low & 0xff
  return bytes
}

/**
 * HOTP — RFC 4226 §5.3
 * Computes a 6-digit HMAC-SHA1 one-time password for the given secret and counter.
 */
async function hotp(secretBytes: Uint8Array<ArrayBuffer>, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )

  const counterBytes = counterToBytes(counter)
  const hmacBuffer = await crypto.subtle.sign('HMAC', key, counterBytes)
  const hmac = new Uint8Array(hmacBuffer)

  // Dynamic truncation (RFC 4226 §5.3)
  const offset = hmac[hmac.length - 1] & 0x0f
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)

  return (code % 1_000_000).toString().padStart(6, '0')
}

/**
 * Constant-time string equality check.
 *
 * Both strings are hashed to SHA-256 first (fixed 32-byte output) before
 * being compared with timingSafeEqual. This prevents length-based timing
 * leaks and is the pattern recommended by Cloudflare's own best practices.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ])
  // timingSafeEqual is a Cloudflare Workers extension not present in standard DOM SubtleCrypto types
  return (crypto.subtle as unknown as { timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean }).timingSafeEqual(hashA, hashB)
}

/**
 * Sanitize and validate a TOTP token string.
 * Returns the cleaned token, or null if invalid.
 */
function sanitizeToken(raw: string): string | null {
  // Strip spaces (some authenticator apps display "123 456")
  const token = raw.replace(/\s/g, '')
  // Must be exactly 6 ASCII digits
  if (!/^\d{6}$/.test(token)) return null
  return token
}

/**
 * Verify a TOTP token against a single Base32-encoded secret.
 *
 * Checks the current time step and ±1 adjacent steps (covers ~30s clock drift).
 * All comparisons are constant-time.
 *
 * @param secret - Base32-encoded TOTP secret (from Cloudflare secret)
 * @param token  - 6-digit token string submitted by the user
 */
export async function verifyToken(secret: string, token: string): Promise<boolean> {
  const cleaned = sanitizeToken(token)
  if (cleaned === null) return false

  // Decode the secret; if this fails, it'll throw. That's desirable for configuration errors.
  let secretBytes: Uint8Array<ArrayBuffer>
  try {
     secretBytes = base32Decode(secret)
  } catch(e) {
     console.error("Invalid TOTP Secret Configuration: ", e)
     return false
  }
  
  const now = Date.now()
  const currentStep = Math.floor(now / 30_000)

  // Check current step and ±1 window
  for (const delta of [-1, 0, 1]) {
    const expected = await hotp(secretBytes, currentStep + delta)
    if (await timingSafeEqual(cleaned, expected)) {
      return true
    }
  }

  return false
}
