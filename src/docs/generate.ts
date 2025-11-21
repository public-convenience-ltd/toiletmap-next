import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { openApiDocument } from './openapi';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OUTPUT_DIR = resolve(__dirname, '../../docs');
const OUTPUT_PATH = resolve(OUTPUT_DIR, 'openapi.json');

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(openApiDocument, null, 2));

console.log(`OpenAPI document written to ${OUTPUT_PATH}`);
