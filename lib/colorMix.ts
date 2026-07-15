// lib/colorMix.ts
// キットの混色プレビュー計算。npm の spectral.js (MIT, 依存なし) を利用する。
// 自作のチャンネル別Kubelka-Munk近似は、白での希釈が機能しない欠陥が実装前の検算で
// 判明したため不採用。spectral.js は白希釈・補色混色(青+黄→緑)の両方で
// 正しい結果になることを事前に検証済み。
// 検証例: mixHexColors([{hex:'#ffffff',ratio:0.5},{hex:'#ff0000',ratio:0.5}]) → 明るいピンク
//         mixHexColors([{hex:'#0000ff',ratio:0.5},{hex:'#ffff00',ratio:0.5}]) → 緑
import * as spectral from 'spectral.js';

export interface MixInput {
  hex: string;
  ratio: number;
}

// 塗料のHEXと割合(比率。合計が1である必要はなく、spectral.js が内部で正規化する)から
// 混色後のHEXを算出する。有効なHEXが1つもなければ null。
export function mixHexColors(paints: MixInput[]): string | null {
  const valid = paints.filter((p) => /^#?[0-9a-fA-F]{6}$/.test(p.hex.replace(/^#/, '')));
  if (valid.length === 0) return null;
  const colors: [InstanceType<typeof spectral.Color>, number][] = valid.map(
    (p) => [new spectral.Color(p.hex), p.ratio]
  );
  return spectral.mix(...colors).toString();
}
