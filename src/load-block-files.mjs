import fs from 'node:fs';
import path from 'node:path';
import { parseBlockFileHeader } from './block-file-header.mjs';
import { parseIndexHeader } from './index-file.mjs';

const BLOCK_FILE_NAME = /^data_(\d+)$/;

/**
 * Reads `index` and every `data_N` in `blockDir` into memory in one go, so
 * the reader works from one consistent copy and holds no handles on the
 * directory afterwards (a snapshot folder can be swapped while it's in use).
 */
export function loadBlockFiles(blockDir) {
  const indexBytes = fs.readFileSync(path.join(blockDir, 'index'));
  const index = { bytes: indexBytes, header: parseIndexHeader(indexBytes) };

  const blockFiles = new Map();
  for (const name of fs.readdirSync(blockDir)) {
    const match = BLOCK_FILE_NAME.exec(name);
    if (!match) continue;
    const bytes = fs.readFileSync(path.join(blockDir, name));
    let header;
    try {
      header = parseBlockFileHeader(bytes);
    } catch (error) {
      throw new Error(`${name}: ${error.message}`);
    }
    blockFiles.set(Number(match[1]), { name, bytes, header });
  }
  return { index, blockFiles };
}
