/**
 * A QR code drawn with plain Views, from qrcode-generator (pure JS): no SVG or
 * other native module, so it works on the build already on people's phones.
 *
 * Each row is drawn as runs of dark modules rather than one View per module —
 * a ticket code is a 25×25 grid, which would otherwise be 600-odd Views.
 *
 * Always black on white with a quiet zone: the gate scans it in sunlight, off
 * a phone held at arm's length, and anything fancier costs reads.
 */
import React, { memo, useMemo } from 'react';
import { View } from 'react-native';
import qrcodeGenerator from 'qrcode-generator';

// The margin the QR spec asks for is 4 modules; 3 still scans reliably and
// leaves the code larger on a small screen.
const QUIET = 3;

/** The code's dark modules as runs per row: `{ count, rows: [[start, length], …] }`. */
export const qrRuns = (value, level = 'M') => {
  const make = qrcodeGenerator.default || qrcodeGenerator;
  const qr = make(0, level);
  qr.addData(String(value));
  qr.make();
  const count = qr.getModuleCount();
  const rows = [];
  for (let r = 0; r < count; r += 1) {
    const runs = [];
    let start = -1;
    for (let c = 0; c <= count; c += 1) {
      const dark = c < count && qr.isDark(r, c);
      if (dark && start < 0) start = c;
      if (!dark && start >= 0) { runs.push([start, c - start]); start = -1; }
    }
    rows.push(runs);
  }
  return { count, rows };
};

const QRCode = ({ value, size = 220, color = '#000', background = '#FFF', accessibilityLabel }) => {
  const { count, rows } = useMemo(() => qrRuns(value), [value]);
  // Whole pixels per module, so edges stay crisp; the remainder is margin.
  const cell = Math.max(1, Math.floor(size / (count + QUIET * 2)));
  const inner = cell * count;
  return (
    <View
      style={{ width: size, height: size, backgroundColor: background, alignItems: 'center', justifyContent: 'center' }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={{ width: inner, height: inner }}>
        {rows.map((runs, r) => (
          <View key={r} style={{ position: 'absolute', top: r * cell, left: 0, width: inner, height: cell }}>
            {runs.map(([start, length]) => (
              <View
                key={start}
                style={{ position: 'absolute', left: start * cell, width: length * cell, height: cell, backgroundColor: color }}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
};

export default memo(QRCode);
