import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// ── SSE: Live search activity feed ──────────────────────────────────
const sseClients = new Set();

app.get('/api/activity', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('data: {"type":"connected"}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcastActivity(event) {
  const msg = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    client.write(msg);
  }
}

// ── Firecrawl Search ──────────────────────────────────────────────────
async function firecrawlSearch(query, limit = 5, label = '') {
  broadcastActivity({ type: 'search_start', query, label });

  const res = await fetch('https://api.firecrawl.dev/v2/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      limit,
      tbs: 'qdr:m',
      scrapeOptions: {
        formats: ['markdown'],
        onlyMainContent: true,
        timeout: 15000,
      },
    }),
  });

  if (!res.ok) {
    console.error(`Firecrawl error: ${res.status}`);
    broadcastActivity({ type: 'search_error', query, label, error: `HTTP ${res.status}` });
    return [];
  }

  const data = await res.json();
  const results = data.data?.web || data.data || [];

  broadcastActivity({
    type: 'search_done',
    query,
    label,
    count: results.length,
    titles: results.slice(0, 4).map(r => r.title || r.url || 'Untitled'),
  });

  return results;
}

// ── Build search context for a brand ──────────────────────────────────
async function buildBrandContext(brand) {
  broadcastActivity({ type: 'brand_start', brand });

  const [general, opinions, news] = await Promise.all([
    firecrawlSearch(`${brand} review 2025 2026`, 4, '📰 Reviews'),
    firecrawlSearch(`${brand} reddit opinions complaints`, 3, '💬 Opinions'),
    firecrawlSearch(`${brand} latest news controversy`, 3, '🔥 News'),
  ]);

  const formatResults = (results, label) => {
    if (!results.length) return `[${label}: no results found]`;
    return results.map(r => {
      const snippet = r.markdown
        ? r.markdown.substring(0, 800)
        : r.description || 'No content';
      return `### ${r.title || 'Untitled'}\nSource: ${r.url || 'unknown'}\n${snippet}`;
    }).join('\n\n');
  };

  const context = `# Live Internet Research for "${brand}"

## General Reviews & Info
${formatResults(general, 'Reviews')}

## Public Opinions (Reddit, Forums)
${formatResults(opinions, 'Opinions')}

## Latest News
${formatResults(news, 'News')}`;

  const totalResults = general.length + opinions.length + news.length;
  broadcastActivity({ type: 'brand_done', brand, totalResults, contextLength: context.length });

  return context;
}

// ── Webhook endpoint for ElevenLabs agent ─────────────────────────────
app.post('/api/vibe-check', async (req, res) => {
  const startTime = Date.now();
  console.log('🎤 Vibe Check webhook hit:', JSON.stringify(req.body));

  try {
    const brand = req.body.brand || req.body.query || 'unknown brand';
    const mode = req.body.mode || 'roast';

    console.log(`🔍 Searching for: "${brand}" in ${mode} mode...`);
    const context = await buildBrandContext(brand);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Search complete in ${elapsed}s — ${context.length} chars`);

    const modeInstruction = mode === 'hype'
      ? 'an enthusiastic, over-the-top HYPE monologue. Find the absolute best in this brand. Be infectious, use superlatives, reference real positive facts.'
      : 'a brutally funny ROAST monologue. Be savage but hilarious — like Simon Cowell crossed with a Reddit thread. Reference real problems and controversies.';

    const response = `Here is fresh internet research about "${brand}". Deliver ${modeInstruction}

RULES:
- Keep it 30-60 seconds when spoken (about 100-180 words)
- Reference SPECIFIC facts from the search results below
- End with a vibe verdict rating out of 10
- Be entertaining above all else

${context}`;

    res.json({ response });
  } catch (err) {
    console.error('❌ Vibe Check error:', err.message);
    res.json({
      response: `I tried to search for information but hit a snag. Just wing it with a ${req.body.mode || 'roast'} about "${req.body.brand || 'this brand'}" based on what you already know. Be entertaining!`,
    });
  }
});

// ── Test endpoint ─────────────────────────────────────────────────────
app.get('/api/test-search', async (req, res) => {
  const brand = req.query.brand || 'Apple';
  const mode = req.query.mode || 'roast';
  console.log(`🧪 Test search: "${brand}" (${mode})`);
  try {
    const context = await buildBrandContext(brand);
    res.json({ brand, mode, results_length: context.length, context });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'vibe-check',
    firecrawl: !!FIRECRAWL_API_KEY,
    elevenlabs: !!ELEVENLABS_API_KEY,
  });
});

// ── Signed URL proxy (keeps API key server-side) ─────────────────────
app.get('/api/signed-url', async (req, res) => {
  const agentId = req.query.agent_id;
  if (!agentId) return res.status(400).json({ error: 'agent_id required' });

  try {
    const resp = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
      { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
    );
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start server ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🎙️  Vibe Check server running on port ${PORT}`);
  console.log(`   Webhook: http://localhost:${PORT}/api/vibe-check`);
  console.log(`   Health:  http://localhost:${PORT}/api/health`);
  console.log(`   SSE:     http://localhost:${PORT}/api/activity`);
  console.log(`   Firecrawl: ${FIRECRAWL_API_KEY ? '✅ configured' : '❌ missing'}`);
  console.log(`   ElevenLabs: ${ELEVENLABS_API_KEY ? '✅ configured' : '❌ missing'}\n`);
});
