import * as ImageManipulator from 'expo-image-manipulator';
// @ts-ignore pako has no bundled types in this Expo project.
import { inflate } from 'pako';

export async function pickImageColor(uri: string, crop: { originX: number; originY: number; width: number; height: number }): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ crop }, { resize: { width: 1, height: 1 } }],
    { base64: true, compress: 1, format: ImageManipulator.SaveFormat.PNG }
  );
  if (!result.base64) throw new Error('missing base64');
  const { r, g, b } = readPngPixel(result.base64);
  return rgbToHex(r, g, b);
}

function readPngPixel(base64: string): { r: number; g: number; b: number } {
  const bytes = decodeBase64(base64);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) throw new Error('invalid png');

  let offset = 8;
  let colorType = 6;
  const idatParts: Uint8Array[] = [];

  while (offset < bytes.length) {
    const length = readUInt32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    if (type === 'IHDR') colorType = bytes[dataStart + 9];
    if (type === 'IDAT') idatParts.push(bytes.slice(dataStart, dataStart + length));
    offset = dataStart + length + 4;
    if (type === 'IEND') break;
  }

  const data = inflate(concat(idatParts)) as Uint8Array;
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (!channels) throw new Error('unsupported png');
  if (data[0] > 4) throw new Error('unsupported filter');
  const pixel = Array.from(data.slice(1, 1 + channels)) as number[];
  // Match the black image preview background when the image has transparency.
  const alpha = channels === 4 ? pixel[3] / 255 : 1;
  return { r: Math.round(pixel[0] * alpha), g: Math.round(pixel[1] * alpha), b: Math.round(pixel[2] * alpha) };
}

function decodeBase64(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/=+$/, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = chars.indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

function readUInt32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
