# create-oneorigin-app

Scaffold an ONEORIGIN starter on Cloudflare Workers in one command. No prompts, no mock data, no placeholder pages.

## Usage

```sh
npx create-oneorigin-app@latest my-site
```

Produces the ONEORIGIN starter site: `public/index.html`, the full asset set, `wrangler.toml` with SPA fallback, npm scripts (`dev`, `check`, `deploy`) and a README with real commands.

### Templates

```sh
npx create-oneorigin-app@latest my-site                      # ONEORIGIN starter (default)
npx create-oneorigin-app@latest api --template worker        # static + JSON API (/api/health)
npx create-oneorigin-app@latest agent --template agent --provider openai
npx create-oneorigin-app@latest agent --template agent --provider base44
```

| Template | What you get |
| --- | --- |
| `oneorigin` | The ONEORIGIN site build, ready to deploy |
| `worker` | Static assets plus a Worker API surface |
| `agent` | Worker exposing `POST /api/agent/message` (provider `openai` or `base44`) |

### Options

| Flag | Default | Notes |
| --- | --- | --- |
| `--template` | `oneorigin` | `oneorigin`, `worker`, `agent` |
| `--provider` | `openai` | agent template only: `openai` or `base44` |
| `--yes` | off | accept defaults |
| `--help` | | usage |

## After scaffolding

```sh
cd my-site
npm install
npm run dev        # local
npm run check      # dry-run, no quota used
npx wrangler login
npm run deploy
```

Requires Node.js 20 or newer. Project names must be lowercase letters, digits and dashes; existing folders are never overwritten.

MIT
