import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { openApiDocument } from './openapi';

const OUTPUT_DIR = resolve(__dirname, '../../docs');
const OUTPUT_PATH = resolve(OUTPUT_DIR, 'openapi.json');

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(openApiDocument, null, 2));

console.log(`OpenAPI document written to ${OUTPUT_PATH}`);
