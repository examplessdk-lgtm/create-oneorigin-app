import { mkdir, writeFile, readdir, readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerFiles, agentFiles, docsFor } from './templates.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const templatesRoot = join(here, '..', 'templates');

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

async function copyDir(from, to, target, rel = '') {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dstRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await copyDir(src, to, target, dstRel);
    } else {
      await mkdir(dirname(join(to, dstRel)), { recursive: true });
      await writeFile(join(to, dstRel), await readFile(src));
      target.push(dstRel);
    }
  }
}

const projectPkg = (name, extra = {}) => JSON.stringify({
  name,
  version: '1.0.0',
  private: true,
  type: 'module',
  scripts: { dev: 'wrangler dev', check: 'wrangler deploy --dry-run', deploy: 'wrangler deploy' },
  devDependencies: { wrangler: '^4.42.0' },
  engines: { node: '>=20' },
  ...extra
}, null, 2) + '\n';

const staticToml = (name) => `name = "${name}"
compatibility_date = "2026-10-01"

[assets]
directory = "./public"
not_found_handling = "single-page-application"
`;

const workerToml = (name, vars = '') => `name = "${name}"
main = "src/index.js"
compatibility_date = "2026-10-01"
${vars ? `\n${vars}\n` : ''}
[assets]
directory = "./public"
binding = "ASSETS"
run_worker_first = ["/api/*"]
`;

export async function create(name, { template, provider }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('project name must be lowercase letters, digits and dashes');
  if (await exists(name)) throw new Error(`folder "${name}" already exists`);

  const written = [];

  if (template === 'oneorigin') {
    const src = join(templatesRoot, 'oneorigin');
    await copyDir(src, name, written, 'public');
    await writeFile(join(name, 'package.json'), projectPkg(name));
    await writeFile(join(name, 'wrangler.toml'), staticToml(name));
    await writeFile(join(name, '.gitignore'), 'node_modules/\n.wrangler/\n.dev.vars\n');
    await writeFile(join(name, 'README.md'), docsFor(name, 'oneorigin'));
    written.push('public/index.html', 'package.json', 'wrangler.toml', '.gitignore', 'README.md');
  } else if (template === 'worker') {
    const files = workerFiles(name);
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(name, path)), { recursive: true });
      await writeFile(join(name, path), content);
      written.push(path);
    }
    await writeFile(join(name, 'package.json'), projectPkg(name));
    await writeFile(join(name, 'wrangler.toml'), workerToml(name));
    await writeFile(join(name, 'README.md'), docsFor(name, 'worker'));
    written.push('package.json', 'wrangler.toml', 'README.md');
  } else if (template === 'agent') {
    if (!['openai', 'base44'].includes(provider)) throw new Error('provider must be openai or base44');
    const files = agentFiles(name, provider);
    await mkdir(join(name, 'public'), { recursive: true });
    await writeFile(join(name, 'public/index.html'), files['public/index.html']);
    await mkdir(join(name, 'src'), { recursive: true });
    await writeFile(join(name, 'src/index.js'), files['src/index.js']);
    await writeFile(join(name, 'package.json'), projectPkg(name));
    await writeFile(join(name, 'wrangler.toml'), workerToml(name, `[vars]\nAGENT_NAME = "${name}"${provider === 'openai' ? '\nAGENT_MODEL = "gpt-6-astra"' : ''}`));
    await writeFile(join(name, '.gitignore'), 'node_modules/\n.wrangler/\n.dev.vars\n');
    await writeFile(join(name, 'README.md'), docsFor(name, 'agent', provider));
    written.push('public/index.html', 'src/index.js', 'package.json', 'wrangler.toml', 'README.md', '.gitignore');
  } else {
    throw new Error(`unknown template "${template}" (oneorigin | worker | agent)`);
  }

  console.log(`created ${name} (${template}${template === 'agent' ? '/' + provider : ''})`);
  for (const f of [...new Set(written)].sort()) console.log('  + ' + f);
  console.log(`
next:
  cd ${name}
  npm install
  npm run dev
  npx wrangler login
  npm run deploy`);
}
