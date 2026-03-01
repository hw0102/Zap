// qr.js — Self-contained QR Code generator and scanner
// Generator: Full QR spec (versions 1-40, byte mode, ECC level L)
// Scanner: BarcodeDetector API with frame-polling fallback
(function () {
  "use strict";

  // =========================================================================
  // QR Code Tables and Constants
  // =========================================================================

  // Number of data codewords for each version (1-40) at ECC level L
  // Format: [totalCodewords, ecCodewordsPerBlock, numBlocks_group1, dataCodewordsPerBlock_group1, numBlocks_group2, dataCodewordsPerBlock_group2]
  var VERSION_TABLE = [
    null, // index 0 unused
    [26, 7, 1, 19, 0, 0],       // V1
    [44, 10, 1, 34, 0, 0],      // V2
    [70, 15, 1, 55, 0, 0],      // V3
    [100, 20, 1, 80, 0, 0],     // V4
    [134, 26, 1, 108, 0, 0],    // V5
    [172, 18, 2, 68, 0, 0],     // V6
    [196, 20, 2, 78, 0, 0],     // V7
    [242, 24, 2, 97, 0, 0],     // V8
    [292, 30, 2, 116, 0, 0],    // V9
    [346, 18, 2, 68, 2, 69],    // V10
    [404, 20, 4, 81, 0, 0],     // V11
    [466, 24, 2, 92, 2, 93],    // V12
    [532, 26, 4, 107, 0, 0],    // V13
    [581, 30, 3, 115, 1, 116],  // V14
    [655, 22, 5, 87, 1, 88],    // V15
    [733, 24, 5, 98, 1, 99],    // V16
    [815, 28, 1, 107, 5, 108],  // V17
    [901, 30, 5, 120, 1, 121],  // V18
    [991, 28, 3, 113, 4, 114],  // V19
    [1085, 28, 3, 107, 5, 108], // V20
    [1156, 28, 4, 116, 4, 117], // V21
    [1258, 28, 2, 111, 7, 112], // V22
    [1364, 30, 4, 121, 5, 122], // V23
    [1474, 30, 6, 117, 4, 118], // V24
    [1588, 26, 8, 106, 4, 107], // V25
    [1706, 28, 10, 114, 2, 115],// V26
    [1828, 30, 8, 122, 4, 123], // V27
    [1921, 30, 3, 117, 10, 118],// V28
    [2051, 30, 7, 116, 7, 117], // V29
    [2185, 30, 5, 115, 10, 116],// V30
    [2323, 30, 13, 115, 3, 116],// V31
    [2465, 30, 17, 115, 0, 0],  // V32
    [2611, 30, 17, 115, 1, 116],// V33
    [2761, 30, 13, 115, 6, 116],// V34
    [2876, 30, 12, 121, 7, 122],// V35
    [3034, 30, 6, 121, 14, 122],// V36
    [3196, 30, 17, 122, 4, 123],// V37
    [3362, 30, 4, 122, 18, 123],// V38
    [3532, 30, 20, 117, 4, 118],// V39
    [3706, 30, 19, 118, 6, 119] // V40
  ];

  // Alignment pattern positions for each version
  var ALIGNMENT_POSITIONS = [
    null, // V0
    [],   // V1
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],  // V10
    [6, 30, 54],
    [6, 32, 58],
    [6, 34, 62],
    [6, 26, 46, 66],
    [6, 26, 48, 70],
    [6, 26, 50, 74],
    [6, 30, 54, 78],
    [6, 30, 56, 82],
    [6, 30, 58, 86],
    [6, 34, 62, 90],  // V20
    [6, 28, 50, 72, 94],
    [6, 26, 50, 74, 98],
    [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106],
    [6, 32, 58, 84, 110],
    [6, 30, 58, 86, 114],
    [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122],
    [6, 30, 54, 78, 102, 126],
    [6, 26, 52, 78, 104, 130],  // V30
    [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138],
    [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150],
    [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158],
    [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166],
    [6, 30, 58, 86, 114, 142, 170]  // V40
  ];

  // Format info bits for ECC level L (00) with mask patterns 0-7
  // Pre-computed: format = (ecl << 3) | mask, with BCH error correction + XOR mask 0x5412
  var FORMAT_INFO_BITS = [
    0x77C4, // L, mask 0
    0x72F3, // L, mask 1
    0x7DAA, // L, mask 2
    0x789D, // L, mask 3
    0x662F, // L, mask 4
    0x6318, // L, mask 5
    0x6C41, // L, mask 6
    0x6976  // L, mask 7
  ];

  // Version information for versions 7-40 (18-bit values)
  var VERSION_INFO = [
    null, null, null, null, null, null, null,
    0x07C94, 0x085BC, 0x09A99, 0x0A4D3, 0x0BBF6, 0x0C762, 0x0D847, 0x0E60D,
    0x0F928, 0x10B78, 0x1145D, 0x12A17, 0x13532, 0x149A6, 0x15683, 0x168C9,
    0x177EC, 0x18EC4, 0x191E1, 0x1AFAB, 0x1B08E, 0x1CC1A, 0x1D33F, 0x1ED75,
    0x1F250, 0x209D5, 0x216F0, 0x228BA, 0x2379F, 0x24B0B, 0x2542E, 0x26A64,
    0x27541, 0x28C69
  ];

  // =========================================================================
  // Galois Field GF(256) Arithmetic (primitive polynomial 0x11D)
  // =========================================================================

  var GF_EXP = new Uint8Array(512);
  var GF_LOG = new Uint8Array(256);

  (function initGaloisField() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x >= 256) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) {
      GF_EXP[j] = GF_EXP[j - 255];
    }
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  // Polynomial multiplication in GF(256)
  function polyMul(p1, p2) {
    var result = new Uint8Array(p1.length + p2.length - 1);
    for (var i = 0; i < p1.length; i++) {
      for (var j = 0; j < p2.length; j++) {
        result[i + j] ^= gfMul(p1[i], p2[j]);
      }
    }
    return result;
  }

  // Generate Reed-Solomon generator polynomial for given number of ECC codewords
  function rsGeneratorPoly(numEcc) {
    var g = new Uint8Array([1]);
    for (var i = 0; i < numEcc; i++) {
      g = polyMul(g, new Uint8Array([1, GF_EXP[i]]));
    }
    return g;
  }

  // Compute Reed-Solomon ECC codewords
  function rsEncode(data, numEcc) {
    var gen = rsGeneratorPoly(numEcc);
    var padded = new Uint8Array(data.length + numEcc);
    padded.set(data);

    for (var i = 0; i < data.length; i++) {
      var coef = padded[i];
      if (coef !== 0) {
        for (var j = 0; j < gen.length; j++) {
          padded[i + j] ^= gfMul(gen[j], coef);
        }
      }
    }

    return padded.subarray(data.length);
  }

  // =========================================================================
  // QR Code Data Encoding
  // =========================================================================

  // Get the minimum version that can hold the given data length in byte mode, ECC L
  function getMinVersion(dataLength) {
    for (var v = 1; v <= 40; v++) {
      var info = VERSION_TABLE[v];
      var totalData = info[2] * info[3] + info[4] * info[5];
      // Byte mode overhead: 4 bits mode + char count bits + 8 bits per char
      var charCountBits = v <= 9 ? 8 : 16;
      var availableBits = totalData * 8;
      var neededBits = 4 + charCountBits + dataLength * 8;
      if (neededBits <= availableBits) return v;
    }
    return -1; // Data too large
  }

  // Encode data into codewords (byte mode, ECC level L)
  function encodeData(text, version) {
    var info = VERSION_TABLE[version];
    var totalDataCodewords = info[2] * info[3] + info[4] * info[5];
    var charCountBits = version <= 9 ? 8 : 16;

    // Build bit stream
    var bits = [];

    function addBits(val, len) {
      for (var i = len - 1; i >= 0; i--) {
        bits.push((val >> i) & 1);
      }
    }

    // Mode indicator: 0100 = byte mode
    addBits(0x4, 4);

    // Character count
    var data;
    if (typeof TextEncoder !== "undefined") {
      data = new TextEncoder().encode(text);
    } else {
      // Fallback for older environments
      data = [];
      for (var ci = 0; ci < text.length; ci++) {
        var code = text.charCodeAt(ci);
        if (code < 0x80) {
          data.push(code);
        } else if (code < 0x800) {
          data.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
        } else {
          data.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
        }
      }
    }

    addBits(data.length, charCountBits);

    // Data
    for (var di = 0; di < data.length; di++) {
      addBits(data[di], 8);
    }

    // Terminator (up to 4 zero bits)
    var totalBits = totalDataCodewords * 8;
    var terminatorLen = Math.min(4, totalBits - bits.length);
    addBits(0, terminatorLen);

    // Pad to byte boundary
    while (bits.length % 8 !== 0) {
      bits.push(0);
    }

    // Pad to fill capacity with alternating 0xEC, 0x11
    var padBytes = [0xEC, 0x11];
    var padIdx = 0;
    while (bits.length < totalBits) {
      addBits(padBytes[padIdx], 8);
      padIdx ^= 1;
    }

    // Convert bits to codewords
    var codewords = new Uint8Array(totalDataCodewords);
    for (var bi = 0; bi < totalDataCodewords; bi++) {
      var val = 0;
      for (var bit = 0; bit < 8; bit++) {
        val = (val << 1) | bits[bi * 8 + bit];
      }
      codewords[bi] = val;
    }

    return codewords;
  }

  // Split data into blocks and compute ECC
  function computeBlocksAndECC(dataCodewords, version) {
    var info = VERSION_TABLE[version];
    var ecPerBlock = info[1];
    var g1Blocks = info[2];
    var g1DataCw = info[3];
    var g2Blocks = info[4];
    var g2DataCw = info[5];

    var dataBlocks = [];
    var ecBlocks = [];
    var offset = 0;

    // Group 1
    for (var i = 0; i < g1Blocks; i++) {
      var block = dataCodewords.subarray(offset, offset + g1DataCw);
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, ecPerBlock));
      offset += g1DataCw;
    }

    // Group 2
    for (var j = 0; j < g2Blocks; j++) {
      var block2 = dataCodewords.subarray(offset, offset + g2DataCw);
      dataBlocks.push(block2);
      ecBlocks.push(rsEncode(block2, ecPerBlock));
      offset += g2DataCw;
    }

    return { dataBlocks: dataBlocks, ecBlocks: ecBlocks };
  }

  // Interleave data and EC codewords
  function interleave(blocks) {
    var dataBlocks = blocks.dataBlocks;
    var ecBlocks = blocks.ecBlocks;
    var result = [];

    // Interleave data codewords
    var maxDataLen = 0;
    for (var i = 0; i < dataBlocks.length; i++) {
      if (dataBlocks[i].length > maxDataLen) maxDataLen = dataBlocks[i].length;
    }
    for (var col = 0; col < maxDataLen; col++) {
      for (var row = 0; row < dataBlocks.length; row++) {
        if (col < dataBlocks[row].length) {
          result.push(dataBlocks[row][col]);
        }
      }
    }

    // Interleave EC codewords
    var maxEcLen = ecBlocks[0].length;
    for (var ecCol = 0; ecCol < maxEcLen; ecCol++) {
      for (var ecRow = 0; ecRow < ecBlocks.length; ecRow++) {
        if (ecCol < ecBlocks[ecRow].length) {
          result.push(ecBlocks[ecRow][ecCol]);
        }
      }
    }

    return result;
  }

  // =========================================================================
  // QR Code Matrix Construction
  // =========================================================================

  function getModuleCount(version) {
    return version * 4 + 17;
  }

  // Create the QR matrix and place all patterns
  function createMatrix(version) {
    var size = getModuleCount(version);
    // 0 = white, 1 = black, -1 = not yet assigned
    var matrix = [];
    var reserved = []; // tracks which modules are reserved (function patterns)
    for (var r = 0; r < size; r++) {
      matrix[r] = new Int8Array(size);
      reserved[r] = new Uint8Array(size);
      for (var c = 0; c < size; c++) {
        matrix[r][c] = 0;
      }
    }
    return { matrix: matrix, reserved: reserved, size: size };
  }

  // Place finder pattern at (row, col) - top-left corner of the 7x7 pattern
  function placeFinderPattern(m, row, col) {
    var pattern = [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 0, 1, 1, 1, 0, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1, 1]
    ];
    for (var r = 0; r < 7; r++) {
      for (var c = 0; c < 7; c++) {
        if (row + r >= 0 && row + r < m.size && col + c >= 0 && col + c < m.size) {
          m.matrix[row + r][col + c] = pattern[r][c];
          m.reserved[row + r][col + c] = 1;
        }
      }
    }
  }

  // Place separators around finder patterns
  function placeSeparators(m) {
    var size = m.size;
    // Horizontal and vertical separators (white lines)
    for (var i = 0; i < 8; i++) {
      // Top-left
      if (i < size) {
        m.matrix[7][i] = 0; m.reserved[7][i] = 1;
        m.matrix[i][7] = 0; m.reserved[i][7] = 1;
      }
      // Top-right
      if (size - 8 + i < size) {
        m.matrix[7][size - 8 + i] = 0; m.reserved[7][size - 8 + i] = 1;
      }
      if (i < size) {
        m.matrix[i][size - 8] = 0; m.reserved[i][size - 8] = 1;
      }
      // Bottom-left
      if (size - 8 + i < size) {
        m.matrix[size - 8 + i][7] = 0; m.reserved[size - 8 + i][7] = 1;
      }
      if (i < size) {
        m.matrix[size - 8][i] = 0; m.reserved[size - 8][i] = 1;
      }
    }
  }

  // Place alignment patterns
  function placeAlignmentPatterns(m, version) {
    if (version < 2) return;
    var positions = ALIGNMENT_POSITIONS[version];
    var pattern = [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 1, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1]
    ];

    for (var i = 0; i < positions.length; i++) {
      for (var j = 0; j < positions.length; j++) {
        var centerR = positions[i];
        var centerC = positions[j];
        // Skip if overlapping with finder patterns
        if (centerR <= 8 && centerC <= 8) continue; // top-left
        if (centerR <= 8 && centerC >= m.size - 9) continue; // top-right
        if (centerR >= m.size - 9 && centerC <= 8) continue; // bottom-left

        for (var r = -2; r <= 2; r++) {
          for (var c = -2; c <= 2; c++) {
            m.matrix[centerR + r][centerC + c] = pattern[r + 2][c + 2];
            m.reserved[centerR + r][centerC + c] = 1;
          }
        }
      }
    }
  }

  // Place timing patterns
  function placeTimingPatterns(m) {
    for (var i = 8; i < m.size - 8; i++) {
      var val = (i + 1) % 2; // alternating, starting with black at position 8
      if (!m.reserved[6][i]) {
        m.matrix[6][i] = val;
        m.reserved[6][i] = 1;
      }
      if (!m.reserved[i][6]) {
        m.matrix[i][6] = val;
        m.reserved[i][6] = 1;
      }
    }
  }

  // Place dark module and reserve format/version info areas
  function reserveInfoAreas(m, version) {
    var size = m.size;

    // Dark module (always present)
    m.matrix[size - 8][8] = 1;
    m.reserved[size - 8][8] = 1;

    // Reserve format info areas (will be written later)
    // Around top-left finder
    for (var i = 0; i <= 8; i++) {
      if (!m.reserved[8][i]) { m.reserved[8][i] = 1; }
      if (!m.reserved[i][8]) { m.reserved[i][8] = 1; }
    }
    // Below top-right finder
    for (var j = 0; j < 8; j++) {
      if (!m.reserved[8][size - 1 - j]) { m.reserved[8][size - 1 - j] = 1; }
    }
    // Right of bottom-left finder
    for (var k = 0; k < 7; k++) {
      if (!m.reserved[size - 1 - k][8]) { m.reserved[size - 1 - k][8] = 1; }
    }

    // Reserve version info areas (versions 7+)
    if (version >= 7) {
      for (var vi = 0; vi < 6; vi++) {
        for (var vj = 0; vj < 3; vj++) {
          // Bottom-left
          m.reserved[size - 11 + vj][vi] = 1;
          // Top-right
          m.reserved[vi][size - 11 + vj] = 1;
        }
      }
    }
  }

  // Place format info bits (two copies as per ISO 18004)
  // The 15-bit format value: bit14 is MSB, bit0 is LSB.
  // The sequence f0..f14 maps to bit14..bit0 (f0 = MSB = bit14).
  function placeFormatInfo(m, mask) {
    var bits = FORMAT_INFO_BITS[mask];
    var size = m.size;

    // Copy 1: Around top-left finder pattern
    // Horizontal (row 8): f0-f5 at cols 0-5, f6 at col 7 (skip col 6), f7 at col 8
    var hCols = [0, 1, 2, 3, 4, 5, 7, 8]; // 8 positions for f0..f7
    for (var i = 0; i < 8; i++) {
      m.matrix[8][hCols[i]] = (bits >> (14 - i)) & 1;
    }
    // Vertical (col 8): f8 at row 7 (skip row 6), f9 at row 5, down to f14 at row 0
    var vRows = [7, 5, 4, 3, 2, 1, 0]; // 7 positions for f8..f14
    for (var j = 0; j < 7; j++) {
      m.matrix[vRows[j]][8] = (bits >> (6 - j)) & 1;
    }

    // Copy 2: Split between bottom-left and top-right
    // Bottom-left (col 8): f0 at row (size-1), f1 at row (size-2), ..., f6 at row (size-7)
    for (var k = 0; k < 7; k++) {
      m.matrix[size - 1 - k][8] = (bits >> (14 - k)) & 1;
    }
    // Top-right (row 8): f7 at col (size-8), f8 at col (size-7), ..., f14 at col (size-1)
    for (var l = 0; l < 8; l++) {
      m.matrix[8][size - 8 + l] = (bits >> (7 - l)) & 1;
    }

    // Dark module is always set (at row size-8, col 8)
    m.matrix[size - 8][8] = 1;
  }

  // Place version info bits (versions 7+)
  function placeVersionInfo(m, version) {
    if (version < 7) return;
    var bits = VERSION_INFO[version];
    var size = m.size;

    for (var i = 0; i < 18; i++) {
      var bit = (bits >> i) & 1;
      var row = Math.floor(i / 3);
      var col = i % 3;
      // Bottom-left block
      m.matrix[size - 11 + col][row] = bit;
      // Top-right block
      m.matrix[row][size - 11 + col] = bit;
    }
  }

  // Place data bits in the matrix using the zigzag pattern
  function placeDataBits(m, dataBits) {
    var size = m.size;
    var bitIdx = 0;
    // Data is placed in 2-column strips from right to left
    // Column 6 is skipped (timing pattern)
    var col = size - 1;
    while (col >= 0) {
      if (col === 6) col--; // skip timing column
      if (col < 0) break;

      // Determine direction: upward for even strip count, downward for odd
      // Strips: col (size-1, size-2), (size-3, size-4), ... skipping 6
      var stripIndex;
      if (col > 6) {
        stripIndex = (size - 1 - col) >> 1;
      } else {
        stripIndex = (size - 2 - col) >> 1;
      }
      var goingUp = (stripIndex % 2 === 0);

      for (var step = 0; step < size; step++) {
        var row = goingUp ? (size - 1 - step) : step;
        // Try right column then left column of the strip
        for (var dc = 0; dc <= 1; dc++) {
          var c = col - dc;
          if (c < 0 || c >= size) continue;
          if (m.reserved[row][c]) continue;
          if (bitIdx < dataBits.length) {
            m.matrix[row][c] = dataBits[bitIdx];
            bitIdx++;
          } else {
            m.matrix[row][c] = 0;
          }
        }
      }

      col -= 2;
    }
  }

  // =========================================================================
  // Masking
  // =========================================================================

  var MASK_FUNCTIONS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r, c) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; },
    function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
    function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; }
  ];

  function applyMask(m, maskNum) {
    var fn = MASK_FUNCTIONS[maskNum];
    for (var r = 0; r < m.size; r++) {
      for (var c = 0; c < m.size; c++) {
        if (!m.reserved[r][c]) {
          if (fn(r, c)) {
            m.matrix[r][c] ^= 1;
          }
        }
      }
    }
  }

  // Evaluate penalty score for a mask
  function evaluatePenalty(matrix, size) {
    var penalty = 0;

    // Rule 1: Adjacent same-color modules in rows and columns
    for (var r = 0; r < size; r++) {
      var runLength = 1;
      for (var c = 1; c < size; c++) {
        if (matrix[r][c] === matrix[r][c - 1]) {
          runLength++;
        } else {
          if (runLength >= 5) penalty += runLength - 2;
          runLength = 1;
        }
      }
      if (runLength >= 5) penalty += runLength - 2;
    }
    for (var c2 = 0; c2 < size; c2++) {
      var runLength2 = 1;
      for (var r2 = 1; r2 < size; r2++) {
        if (matrix[r2][c2] === matrix[r2 - 1][c2]) {
          runLength2++;
        } else {
          if (runLength2 >= 5) penalty += runLength2 - 2;
          runLength2 = 1;
        }
      }
      if (runLength2 >= 5) penalty += runLength2 - 2;
    }

    // Rule 2: 2x2 blocks of same color
    for (var r3 = 0; r3 < size - 1; r3++) {
      for (var c3 = 0; c3 < size - 1; c3++) {
        var val = matrix[r3][c3];
        if (val === matrix[r3][c3 + 1] &&
            val === matrix[r3 + 1][c3] &&
            val === matrix[r3 + 1][c3 + 1]) {
          penalty += 3;
        }
      }
    }

    // Rule 3: Finder-like patterns (1011101 preceded/followed by 4 whites)
    for (var r4 = 0; r4 < size; r4++) {
      for (var c4 = 0; c4 < size - 10; c4++) {
        if (matrix[r4][c4] === 1 && matrix[r4][c4 + 1] === 0 &&
            matrix[r4][c4 + 2] === 1 && matrix[r4][c4 + 3] === 1 &&
            matrix[r4][c4 + 4] === 1 && matrix[r4][c4 + 5] === 0 &&
            matrix[r4][c4 + 6] === 1 &&
            matrix[r4][c4 + 7] === 0 && matrix[r4][c4 + 8] === 0 &&
            matrix[r4][c4 + 9] === 0 && matrix[r4][c4 + 10] === 0) {
          penalty += 40;
        }
        if (matrix[r4][c4] === 0 && matrix[r4][c4 + 1] === 0 &&
            matrix[r4][c4 + 2] === 0 && matrix[r4][c4 + 3] === 0 &&
            matrix[r4][c4 + 4] === 1 && matrix[r4][c4 + 5] === 0 &&
            matrix[r4][c4 + 6] === 1 && matrix[r4][c4 + 7] === 1 &&
            matrix[r4][c4 + 8] === 1 && matrix[r4][c4 + 9] === 0 &&
            matrix[r4][c4 + 10] === 1) {
          penalty += 40;
        }
      }
    }
    for (var c5 = 0; c5 < size; c5++) {
      for (var r5 = 0; r5 < size - 10; r5++) {
        if (matrix[r5][c5] === 1 && matrix[r5 + 1][c5] === 0 &&
            matrix[r5 + 2][c5] === 1 && matrix[r5 + 3][c5] === 1 &&
            matrix[r5 + 4][c5] === 1 && matrix[r5 + 5][c5] === 0 &&
            matrix[r5 + 6][c5] === 1 &&
            matrix[r5 + 7][c5] === 0 && matrix[r5 + 8][c5] === 0 &&
            matrix[r5 + 9][c5] === 0 && matrix[r5 + 10][c5] === 0) {
          penalty += 40;
        }
        if (matrix[r5][c5] === 0 && matrix[r5 + 1][c5] === 0 &&
            matrix[r5 + 2][c5] === 0 && matrix[r5 + 3][c5] === 0 &&
            matrix[r5 + 4][c5] === 1 && matrix[r5 + 5][c5] === 0 &&
            matrix[r5 + 6][c5] === 1 && matrix[r5 + 7][c5] === 1 &&
            matrix[r5 + 8][c5] === 1 && matrix[r5 + 9][c5] === 0 &&
            matrix[r5 + 10][c5] === 1) {
          penalty += 40;
        }
      }
    }

    // Rule 4: Proportion of dark modules
    var totalModules = size * size;
    var darkCount = 0;
    for (var r6 = 0; r6 < size; r6++) {
      for (var c6 = 0; c6 < size; c6++) {
        if (matrix[r6][c6] === 1) darkCount++;
      }
    }
    var percent = (darkCount / totalModules) * 100;
    var prevFive = Math.floor(percent / 5) * 5;
    var nextFive = prevFive + 5;
    penalty += Math.min(Math.abs(prevFive - 50) / 5, Math.abs(nextFive - 50) / 5) * 10;

    return penalty;
  }

  // Deep copy a matrix
  function copyMatrix(m) {
    var copy = {
      matrix: [],
      reserved: m.reserved, // reserved doesn't change
      size: m.size
    };
    for (var r = 0; r < m.size; r++) {
      copy.matrix[r] = new Int8Array(m.matrix[r]);
    }
    return copy;
  }

  // =========================================================================
  // Main QR Generation Pipeline
  // =========================================================================

  function generateQRMatrix(text) {
    // Encode text to bytes to determine actual byte length
    var textBytes;
    if (typeof TextEncoder !== "undefined") {
      textBytes = new TextEncoder().encode(text);
    } else {
      textBytes = [];
      for (var ci = 0; ci < text.length; ci++) {
        var code = text.charCodeAt(ci);
        if (code < 0x80) {
          textBytes.push(code);
        } else if (code < 0x800) {
          textBytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
        } else {
          textBytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
        }
      }
    }

    var version = getMinVersion(textBytes.length);
    if (version < 0) {
      throw new Error("Data too large for QR code (max ~2953 bytes at ECC L)");
    }

    // Encode data into codewords
    var dataCodewords = encodeData(text, version);

    // Compute ECC and interleave
    var blocks = computeBlocksAndECC(dataCodewords, version);
    var finalCodewords = interleave(blocks);

    // Convert to bit array
    var dataBits = [];
    for (var i = 0; i < finalCodewords.length; i++) {
      for (var bit = 7; bit >= 0; bit--) {
        dataBits.push((finalCodewords[i] >> bit) & 1);
      }
    }

    // Add remainder bits (depending on version)
    var remainderBits = 0;
    if (version >= 2 && version <= 6) remainderBits = 7;
    else if (version >= 14 && version <= 20) remainderBits = 3;
    else if (version >= 21 && version <= 27) remainderBits = 4;
    else if (version >= 28 && version <= 34) remainderBits = 3;
    // Versions 1, 7-13, 35-40 have 0 remainder bits
    for (var rb = 0; rb < remainderBits; rb++) {
      dataBits.push(0);
    }

    // Build matrix
    var m = createMatrix(version);

    // Place function patterns
    placeFinderPattern(m, 0, 0);
    placeFinderPattern(m, 0, m.size - 7);
    placeFinderPattern(m, m.size - 7, 0);
    placeSeparators(m);
    placeAlignmentPatterns(m, version);
    placeTimingPatterns(m);
    reserveInfoAreas(m, version);

    // Place version info
    placeVersionInfo(m, version);

    // Place data
    placeDataBits(m, dataBits);

    // Try all 8 masks and pick the best one
    var bestMask = 0;
    var bestPenalty = Infinity;
    var bestMatrix = null;

    for (var mask = 0; mask < 8; mask++) {
      var trial = copyMatrix(m);
      applyMask(trial, mask);
      placeFormatInfo(trial, mask);
      var penalty = evaluatePenalty(trial.matrix, trial.size);
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestMask = mask;
        bestMatrix = trial;
      }
    }

    return { matrix: bestMatrix.matrix, size: bestMatrix.size, version: version };
  }

  // =========================================================================
  // Canvas Rendering
  // =========================================================================

  function renderToCanvas(qr, canvas, pixelSize) {
    var moduleCount = qr.size;
    var quietZone = 4; // standard quiet zone
    var totalModules = moduleCount + quietZone * 2;
    var cellSize = Math.floor(pixelSize / totalModules);
    if (cellSize < 1) cellSize = 1;

    var actualSize = cellSize * totalModules;
    canvas.width = actualSize;
    canvas.height = actualSize;

    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, actualSize, actualSize);

    ctx.fillStyle = "#000000";
    for (var r = 0; r < moduleCount; r++) {
      for (var c = 0; c < moduleCount; c++) {
        if (qr.matrix[r][c] === 1) {
          ctx.fillRect(
            (c + quietZone) * cellSize,
            (r + quietZone) * cellSize,
            cellSize,
            cellSize
          );
        }
      }
    }
  }

  // =========================================================================
  // Public: QR.generate(text, canvas, size)
  // =========================================================================

  function generate(text, canvas, size) {
    if (!text || !canvas) {
      throw new Error("QR.generate requires text and canvas arguments");
    }
    size = size || 512;
    var qr = generateQRMatrix(text);
    renderToCanvas(qr, canvas, size);
    return qr.version;
  }

  // =========================================================================
  // QR Code Scanning (BarcodeDetector API with fallback)
  // =========================================================================

  function scan(videoElement, canvasElement, timeoutMs) {
    timeoutMs = timeoutMs || 15000;

    return new Promise(function (resolve, reject) {
      var stopped = false;
      var timeoutId;

      function cleanup() {
        stopped = true;
        if (timeoutId) clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(function () {
        cleanup();
        reject(new Error("QR scan timed out after " + timeoutMs + "ms"));
      }, timeoutMs);

      // Check for BarcodeDetector support
      var hasBarcodeDetector = typeof BarcodeDetector !== "undefined";

      if (hasBarcodeDetector) {
        scanWithBarcodeDetector(videoElement, canvasElement, resolve, function () { return stopped; }, cleanup);
      } else {
        // Fallback: use canvas-based frame capture and attempt decoding via ImageBitmap
        scanWithCanvasFallback(videoElement, canvasElement, resolve, reject, function () { return stopped; }, cleanup);
      }
    });
  }

  function scanWithBarcodeDetector(video, canvas, resolve, isStopped, cleanup) {
    var detector = new BarcodeDetector({ formats: ["qr_code"] });

    function captureFrame() {
      if (isStopped()) return;

      // Ensure video has valid dimensions
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        requestAnimationFrame(captureFrame);
        return;
      }

      // Size canvas to match video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Try detecting from the video element directly (more efficient)
      detector.detect(video).then(function (barcodes) {
        if (isStopped()) return;
        if (barcodes.length > 0 && barcodes[0].rawValue) {
          cleanup();
          resolve(barcodes[0].rawValue);
          return;
        }
        // Also try from canvas as fallback
        return detector.detect(canvas);
      }).then(function (barcodes) {
        if (isStopped()) return;
        if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
          cleanup();
          resolve(barcodes[0].rawValue);
          return;
        }
        // Continue scanning
        requestAnimationFrame(captureFrame);
      }).catch(function () {
        if (isStopped()) return;
        requestAnimationFrame(captureFrame);
      });
    }

    // Start scanning after a short delay to ensure video is ready
    if (video.readyState >= 2) {
      requestAnimationFrame(captureFrame);
    } else {
      video.addEventListener("loadeddata", function () {
        requestAnimationFrame(captureFrame);
      }, { once: true });
    }
  }

  function scanWithCanvasFallback(video, canvas, resolve, reject, isStopped, cleanup) {
    // Fallback approach: periodically capture frames and try to decode
    // This is a minimal fallback for environments without BarcodeDetector
    // In practice, BarcodeDetector is available in all modern browsers (Chrome 83+, Safari 15.4+)

    var attempts = 0;
    var maxAttempts = 150; // ~5 seconds at 30fps

    function tryDecode() {
      if (isStopped()) return;

      if (video.videoWidth === 0 || video.videoHeight === 0) {
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(tryDecode, 100);
        }
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Without BarcodeDetector, we cannot decode QR codes in this fallback
      // Notify the caller that native QR detection is required
      attempts++;
      if (attempts >= maxAttempts) {
        cleanup();
        reject(new Error("QR scanning requires BarcodeDetector API (available in Chrome 83+ and Safari 15.4+)"));
        return;
      }

      setTimeout(tryDecode, 100);
    }

    if (video.readyState >= 2) {
      tryDecode();
    } else {
      video.addEventListener("loadeddata", function () {
        tryDecode();
      }, { once: true });
    }
  }

  // =========================================================================
  // Feature detection helper
  // =========================================================================

  function isSupported() {
    return {
      generate: typeof HTMLCanvasElement !== "undefined",
      scan: typeof BarcodeDetector !== "undefined",
      barcodeDetector: typeof BarcodeDetector !== "undefined"
    };
  }

  // =========================================================================
  // Export
  // =========================================================================

  window.QR = {
    generate: generate,
    scan: scan,
    isSupported: isSupported
  };

})();
