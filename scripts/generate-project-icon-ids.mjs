import * as icons from '@radix-ui/react-icons';
import { writeFileSync } from 'node:fs';

// Keep searchable metadata independent of the complete SVG implementation.
const ids = Object.keys(icons).filter(id => id.endsWith('Icon')).sort();
writeFileSync('src/workspace/project-appearance/projectIconIds.ts',
  '// Generated from @radix-ui/react-icons; names only, no SVG bundle.\n' +
  '// Regenerate with: node scripts/generate-project-icon-ids.mjs\n' +
  `export const projectIconIds = ${JSON.stringify(ids, null, 2)} as const;\n`);
