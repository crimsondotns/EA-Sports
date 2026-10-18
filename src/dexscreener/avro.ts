// Minimal reader for the Avro binary encoding DEX Screener uses on io.dexscreener.com.

export class AvroReader {
  private pos = 0;
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private static readonly decoder = new TextDecoder();

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get done(): boolean {
    return this.pos >= this.bytes.length;
  }

  /** Zigzag-encoded variable-length long. */
  long(): number {
    let n = 0n;
    let shift = 0n;
    for (;;) {
      if (this.done) throw new RangeError("Unexpected end of data while reading varint");
      const b = this.bytes[this.pos++]!;
      n |= BigInt(b & 0x7f) << shift;
      shift += 7n;
      if (b < 0x80) break;
    }
    return Number((n >> 1n) ^ -(n & 1n));
  }

  double(): number {
    this.ensure(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  string(): string {
    const len = this.long();
    this.ensure(len);
    const v = AvroReader.decoder.decode(this.bytes.subarray(this.pos, this.pos + len));
    this.pos += len;
    return v;
  }

  /** Union of [null, string]. */
  optionalString(): string | null {
    return this.long() === 1 ? this.string() : null;
  }

  private ensure(n: number): void {
    if (n < 0 || this.pos + n > this.bytes.length) {
      throw new RangeError(`Unexpected end of data at byte ${this.pos} (need ${n})`);
    }
  }
}
