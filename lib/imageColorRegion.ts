export function constrainImagePosition(width: number, height: number, scale: number, x: number, y: number, frame: number) {
  const maxX = Math.max(0, (width * scale - frame) / 2);
  const maxY = Math.max(0, (height * scale - frame) / 2);
  return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
}

export function imageColorRegion(width: number, height: number, scale: number, x: number, y: number, frame: number) {
  const size = Math.max(1, Math.min(width, height, Math.round(frame / scale)));
  return {
    originX: Math.max(0, Math.min(width - size, Math.round(width / 2 - x / scale - size / 2))),
    originY: Math.max(0, Math.min(height - size, Math.round(height / 2 - y / scale - size / 2))),
    width: size,
    height: size,
  };
}
