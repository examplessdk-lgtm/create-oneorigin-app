const html = (name) => `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${name}</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; min-height:100svh; display:grid; place-items:center; background:#06090f; color:#e9eef7;
         font:16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif }
  main { width:min(680px, 90vw); padding:40px; border:1px solid #1d2a3f; border-radius:18px; background:#0b1220 }
  h1 { margin:0 0 8px; font-size:32px; letter-spacing:-.5px }
  p { margin:0 0 20px; color:#9fb0c8 }
  code { background:#111c2e; padding:2px 6px; border-radius:6px; color:#7cc4ff }
</style></head>
<body><main>
  <h1>${name}</h1>
  <p>Worker ready. Static files in <code>public/</code>, API routes in <code>src/index.js</code>.</p>
</main></body></html>
`;

export function workerFiles(name) {
  return {
    'public/index.html': html(name),
    'src/index.js': `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, name: env.APP_NAME ?? '${name}', time: new Date().toISOString() });
    }
    if (url.pathname.startsWith('/api/')) {
      return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  }
};
`
  };
}

const base44Src = (name) => `// Agent worker: Base44 Agent API proxy. Key stays server-side.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return Response.json({ ok: true, agent: env.AGENT_NAME ?? '${name}', provider: 'base44' });
    if (url.pathname !== '/api/agent/message' || request.method !== 'POST') {
      if (url.pathname.startsWith('/api/')) return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
      return env.ASSETS.fetch(request);
    }
    let body;
    try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return Response.json({ ok: false, error: 'message_required' }, { status: 400 });
    if (!env.BASE44_API_KEY || !env.BASE44_AGENT_ID) return Response.json({ ok: false, error: 'not_configured' }, { status: 503 });

    const base = 'https://app.base44.com/api/agents/' + env.BASE44_AGENT_ID;
    const headers = { api_key: env.BASE44_API_KEY, 'content-type': 'application/json' };
    try {
      let conversationId = typeof body.conversation_id === 'string' ? body.conversation_id : '';
      if (!conversationId) {
        const created = await fetch(base + '/conversations', { method: 'POST', headers, body: JSON.stringify({}) });
        if (!created.ok) return Response.json({ ok: false, error: 'conversation_failed', status: created.status }, { status: 502 });
        const conv = await created.json();
        conversationId = conv.id ?? '';
      }
      const sent = await fetch(base + '/conversations/' + conversationId + '/messages', { method: 'POST', headers, body: JSON.stringify({ content: message }) });
      const data = await sent.json().catch(() => ({}));
      if (!sent.ok) return Response.json({ ok: false, error: 'message_failed', status: sent.status, detail: data }, { status: 502 });
      return Response.json({ ok: true, conversation_id: conversationId, reply: data.content ?? data.message ?? data });
    } catch {
      return Response.json({ ok: false, error: 'upstream_unreachable' }, { status: 502 });
    }
  }
};
`;

const openaiSrc = (name) => `// Agent worker: OpenAI Agents API sessions. Key stays server-side.
const SESSIONS = 'https://api.openai.com/v1/agents/sessions';

async function runTurn(env, input) {
  let res;
  try {
    res = await fetch(SESSIONS, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + env.OPENAI_API_KEY, 'content-type': 'application/json', 'openai-beta': 'agents=v1' },
      body: JSON.stringify({
        agent: { model: env.AGENT_MODEL ?? 'gpt-6-astra', instructions: env.AGENT_INSTRUCTIONS ?? 'Answer accurately and directly in the user language.' },
        environment: { type: 'openai_hosted' },
        input,
        stream: true
      })
    });
  } catch { return { error: 'upstream_unreachable' }; }
  if (!res.ok) return { error: 'session_failed', status: res.status };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parts = new Map();
  let buffer = '';
  let ended = null;
  const touch = (e) => {
    const key = e.item_id + ':' + e.output_index + ':' + e.content_index;
    if (!parts.has(key)) parts.set(key, { o: e.output_index, c: e.content_index, text: '' });
    return key;
  };
  try {
    while (!ended) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut;
      while (!ended && (cut = buffer.indexOf('\\n')) !== -1) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (!line.startsWith('data:')) continue;
        let e; try { e = JSON.parse(line.slice(5)); } catch { continue; }
        if (e.type === 'agent.session.turn.output_text.delta') parts.get(touch(e)).text += e.delta ?? '';
        else if (e.type === 'agent.session.turn.output_text.done') { const k = touch(e); if (e.text) parts.get(k).text = e.text; }
        else if (e.type === 'agent.session.turn.completed' && !(e.turn && e.turn.subagent_id != null)) ended = 'completed';
        else if ((e.type === 'agent.session.turn.failed' || e.type === 'error' || e.type === 'agent.session.failed') && !(e.turn && e.turn.subagent_id != null)) ended = 'failed';
      }
    }
  } catch { return { error: 'stream_failed' }; } finally { try { reader.cancel(); } catch {} }
  const output = [...parts.values()].sort((a, b) => a.o - b.o || a.c - b.c).map((p) => p.text).join('\\n').trim();
  if (ended === 'failed' || !output) return { error: 'turn_failed' };
  return { output };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return Response.json({ ok: true, agent: env.AGENT_NAME ?? '${name}', provider: 'openai', model: env.AGENT_MODEL ?? 'gpt-6-astra' });
    if (url.pathname !== '/api/agent/message' || request.method !== 'POST') {
      if (url.pathname.startsWith('/api/')) return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
      return env.ASSETS.fetch(request);
    }
    let body;
    try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return Response.json({ ok: false, error: 'message_required' }, { status: 400 });
    if (!env.OPENAI_API_KEY) return Response.json({ ok: false, error: 'not_configured' }, { status: 503 });
    const result = await runTurn(env, message);
    if (result.error) return Response.json({ ok: false, error: result.error, status: result.status }, { status: 502 });
    return Response.json({ ok: true, reply: result.output });
  }
};
`;

export function agentFiles(name, provider) {
  return {
    'public/index.html': html(name),
    'src/index.js': provider === 'base44' ? base44Src(name) : openaiSrc(name)
  };
}

export function docsFor(name, template, provider) {
  if (template === 'oneorigin') {
    return `# ${name}

ONEORIGIN starter site on Cloudflare Workers Static Assets.

## Commands

\`\`\`sh
npm install
npm run dev        # local preview
npm run check      # dry-run, no quota used
npm run deploy     # deploy
\`\`\`

## Structure

\`\`\`
wrangler.toml      Static Assets with SPA fallback
public/index.html  entry page
public/assets/     site build (JS/CSS chunks)
\`\`\`

## Custom domain

Add to \`wrangler.toml\`, then \`npm run deploy\`:

\`\`\`toml
[[routes]]
pattern = "your-domain.com"
custom_domain = true
\`\`\`
`;
  }
  if (template === 'worker') {
    return `# ${name}

Worker with static assets and a JSON API surface.

## Endpoints

\`\`\`
GET /api/health   -> { ok, name, time }
\`\`\`

## Commands

\`\`\`sh
npm install
npm run dev
npm run deploy
\`\`\`
`;
  }
  const secrets = provider === 'base44'
    ? `npx wrangler secret put BASE44_API_KEY\nnpx wrangler secret put BASE44_AGENT_ID`
    : `npx wrangler secret put OPENAI_API_KEY`;
  return `# ${name}

Agent worker (provider: ${provider}) on Cloudflare Workers.

## Endpoints

\`\`\`
GET  /api/health          status + agent identity
POST /api/agent/message   { "message": "..." }  ->  { ok, reply }
\`\`\`

## Secrets

\`\`\`sh
${secrets}
\`\`\`

## Test after deploy

\`\`\`sh
curl -X POST https://YOUR-WORKER.workers.dev/api/agent/message \\
  -H "content-type: application/json" -d '{"message":"สวัสดี"}'
\`\`\`
`;
}
