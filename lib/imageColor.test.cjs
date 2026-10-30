const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
const { deflateSync } = require('node:zlib');

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, body, checksum]);
}

function pixel(r, g, b, a) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, r, g, b, a]))), chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

test('sampling uses the selected region and composites transparent pixels over black', async () => {
  const source = fs.readFileSync(require.resolve('./imageColor.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  const region = { originX: 10, originY: 20, width: 30, height: 30 };
  let base64;
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === 'pako') return require('pako');
    if (id === 'expo-image-manipulator') return {
      SaveFormat: { PNG: 'png' },
      manipulateAsync: async (uri, actions) => {
        assert.equal(uri, 'photo.png');
        assert.deepEqual(actions, [{ crop: region }, { resize: { width: 1, height: 1 } }]);
        return { base64 };
      },
    };
    throw new Error(`Unexpected module: ${id}`);
  }, module, module.exports);
  for (const [alpha, expected] of [[255, '#FF0000'], [128, '#800000'], [0, '#000000']]) {
    base64 = pixel(255, 0, 0, alpha);
    assert.equal(await module.exports.pickImageColor('photo.png', region), expected);
  }
});
