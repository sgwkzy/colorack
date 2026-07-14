declare module 'spectral.js' {
  export class Color {
    constructor(value: string | number[]);
    tintingStrength: number;
    toString(): string;
  }
  export function mix(...colors: [Color, number][]): Color;
}
