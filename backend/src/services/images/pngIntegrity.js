import { inflateSync } from 'node:zlib';
const MAX_IMAGE_BYTES=16*1024*1024;
const MAX_PIXELS=16*1024*1024;
/** Bounded PNG integrity/decompression validation without a native image library. */
export function validatePng(bytes) {
  if (bytes.length < 45 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Only valid PNG images are supported.');
  let offset = 8, width, height, rowBytes, ended = false, idatStarted = false;
  const compressed = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > MAX_IMAGE_BYTES || offset + length + 12 > bytes.length) throw new Error('Truncated PNG.');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    // PNG CRC32 covers the four type bytes followed by the chunk payload.
    let crc = 0xffffffff;
    for (const value of bytes.subarray(offset + 4, offset + 8 + length)) {
      crc ^= value;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(offset + 8 + length)) throw new Error('PNG checksum mismatch.');
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13) throw new Error('Missing PNG header.');
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[chunk[9]];
      if (!width || !height || width * height > MAX_PIXELS || chunk[8] !== 8 || !channels || chunk[10] || chunk[11] || chunk[12]) throw new Error('Unsupported PNG dimensions/encoding. Use noninterlaced 8-bit PNG.');
      rowBytes = width * channels + 1;
    } else if (type === 'IHDR') throw new Error('Duplicate PNG header.');
    if (type === 'IDAT') { compressed.push(chunk); idatStarted = true; }
    if (type === 'IEND') {
      if (length || !idatStarted || offset + 12 !== bytes.length) throw new Error('Invalid PNG end.');
      ended = true; break;
    }
    offset += length + 12;
  }
  if (!ended) throw new Error('Incomplete PNG image.');
  const expected = rowBytes * height;
  const decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
  if (decoded.length !== expected) throw new Error('Invalid PNG pixel payload.');
  for (let y = 0; y < height; y++) if (decoded[y * rowBytes] > 4) throw new Error('Invalid PNG filter.');
  return { width, height };
}
