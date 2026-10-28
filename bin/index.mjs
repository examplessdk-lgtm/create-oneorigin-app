#!/usr/bin/env node
import { create } from '../lib/create.mjs';

const argv = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '-y' || a === '--yes') { flags.yes = true; continue; }
  if (a === '-h' || a === '--help') { flags.help = true; continue; }
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('-')) { flags[key] = next; i++; } else flags[key] = true;
    continue;
  }
  args.push(a);
}

if (flags.help || (!args[0] && !flags.yes)) {
  console.log(`create-oneorigin-app

  npx create-oneorigin-app@latest <project-name> [options]

  --template oneorigin|worker|agent   default: oneorigin (your ONEORIGIN starter site)
  --provider openai|base44            agent template only, default: openai
  --yes                               accept defaults
  --help                              this message
`);
  process.exit(flags.help ? 0 : 1);
}

const name = args[0] ?? 'oneorigin-site';
try {
  await create(name, { template: flags.template ?? 'oneorigin', provider: flags.provider ?? 'openai' });
} catch (e) {
  console.error('error: ' + e.message);
  process.exit(1);
}
