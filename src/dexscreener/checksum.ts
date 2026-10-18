// EIP-55 checksum for EVM addresses. The bars endpoint returns no bars for an all-lowercase
// pair address, so addresses are sent in checksum case. Node has SHA3 but not Keccak-256.

const RC = [
  0x1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n, 0x8000000080008081n,
  0x8000000000008009n, 0x8an, 0x88n, 0x80008009n, 0x8000000an, 0x8000808bn, 0x800000000000008bn,
  0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x800an,
  0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n,
];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const M = (1n << 64n) - 1n;
const rotl = (x: bigint, n: number) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M);

function keccakF(s: bigint[]): void {
  for (const rc of RC) {
    const c = [0, 1, 2, 3, 4].map((x) => s[x]! ^ s[x + 5]! ^ s[x + 10]! ^ s[x + 15]! ^ s[x + 20]!);
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5]! ^ rotl(c[(x + 1) % 5]!, 1);
      for (let y = 0; y < 25; y += 5) s[x + y]! ^= d;
    }
    const b: bigint[] = new Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y]!, ROT[x + 5 * y]!);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 25; y += 5) s[x + y] = b[x + y]! ^ (~b[((x + 1) % 5) + y]! & M & b[((x + 2) % 5) + y]!);
    s[0] = s[0]! ^ rc;
  }
}

/** Keccak-256 (the pre-standard SHA3 Ethereum uses) of a short input, as hex. */
export function keccak256(data: Uint8Array): string {
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((data.length + 1) / rate) * rate);
  padded.set(data);
  padded[data.length]! ^= 0x01;
  padded[padded.length - 1]! ^= 0x80;
  const s: bigint[] = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let k = 7; k >= 0; k--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + k]!);
      s[i] = s[i]! ^ lane;
    }
    keccakF(s);
  }
  let hex = "";
  for (let i = 0; i < 4; i++) for (let k = 0; k < 8; k++) hex += Number((s[i]! >> BigInt(8 * k)) & 0xffn).toString(16).padStart(2, "0");
  return hex;
}

/** EIP-55 case for a 20-byte 0x address; anything else (Solana, Uniswap v4 pool ids) is returned as is. */
export function toChecksumAddress(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return address;
  const lower = address.slice(2).toLowerCase();
  const hash = keccak256(new TextEncoder().encode(lower));
  let out = "0x";
  for (let i = 0; i < 40; i++) out += parseInt(hash[i]!, 16) >= 8 ? lower[i]!.toUpperCase() : lower[i];
  return out;
}
