import {copyFileSync} from 'node:fs';
copyFileSync(new URL('../src/media-documents.py',import.meta.url),new URL('../dist/media-documents.py',import.meta.url));
