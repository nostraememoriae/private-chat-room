
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(data: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < data.length; i++) {
    value = (value << 8) | data[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

const secret1 = crypto.getRandomValues(new Uint8Array(20)); // 160 bits (standard)
const secret2 = crypto.getRandomValues(new Uint8Array(20));

console.log("Generated Secrets (put these in wrangler.jsonc or .dev.vars):");
console.log("TOTP_SECRET_1: " + base32Encode(secret1));
console.log("TOTP_SECRET_2: " + base32Encode(secret2));
console.log("QR Codes for Authenticator App (use URL generic):");
console.log(`otpauth://totp/PrivateChat:User1?secret=${base32Encode(secret1)}&issuer=PrivateChat`);
console.log(`otpauth://totp/PrivateChat:User2?secret=${base32Encode(secret2)}&issuer=PrivateChat`);
