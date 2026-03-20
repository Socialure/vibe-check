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

// ── Firecrawl Search ──────────────────────────────────────────────────
async function firecrawlSearch(query, limit = 5) {
  const res = await fetch('https://api.firecrawl.dev/v2/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`
    },
    body: JSON.stringify({
      query,
      limit,
      tbs: 'qdr:m', // past month for freshness
      scrapeOptions: {
        formats: ['markdown'],
        onlyMainContent: true,
        timeout: 15000
      }
    })
  });
  if (!res.ok) {
    console.error(`Firecrawl error: ${res.status}`);
    return [];
  }
  const data = await res.json();
  return data.data?.web || data.data || [];
}

// ── Build search context for a brand ──────────────────────────────────
async function buildBrandContext(brand) {
  // Run multiple searches in parallel for rich context
  const [general, opinions, news] = await Promise.all([
    firecrawlSearch(`${brand} review 2025 2026`, 4),
    firecrawlSearch(`${brand} reddit opinions complaints`, 3),
    firecrawlSearch(`${brand} latest news controversy`, 3)
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

  return `# Live Internet Research for "${brand}"

## General Reviews & Info
${formatResults(general, 'Reviews')}

## Public Opinions (Reddit, Forums)
${formatResults(opinions, 'Opinions')}

## Latest News
${formatResults(news, 'News')}`;
}

// ── Webhook endpoint for ElevenLabs agent ─────────────────────────────
// ElevenLabs sends: { brand: string, mode: string }
// We return: { response: string } with the search context
app.post('/api/vibe-check', async (req, res) => {
  const startTime = Date.now();
  console.log('🎤 Vibe Check webhook hit:', JSON.stringify(req.body));

  try {
    // ElevenLabs server tool sends body params as defined in the schema
    const brand = req.body.brand || req.body.query || 'unknown brand';
    const mode = req.body.mode || 'roast';

    console.log(`🔍 Searching for: "${brand}" in ${mode} mode...`);
    const context = await buildBrandContext(brand);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Search complete in ${elapsed}s`);

    // Return context for the LLM to synthesize into a monologue
    const response = `Here is fresh internet research about "${brand}". Use this to deliver a ${mode === 'hype' ? 'enthusiastic hype' : 'brutally funny roast'} monologue (30-60 seconds when spoken). Be specific — reference actual facts from the search results:\n\n${context}`;

    res.json({ response });
  } catch (err) {
    console.error('❌ Vibe Check error:', err.message);
    res.json({
      response: `I tried to search for information but hit a snag. Just wing it with a ${req.body.mode || 'roast'} about "${req.body.brand || 'this brand'}" based on what you already know. Be entertaining!`
    });
  }
});

// ── Health check ──────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'vibe-check',
    firecrawl: !!FIRECRAWL_API_KEY,
    elevenlabs: !!ELEVENLABS_API_KEY
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
  console.log(`   Firecrawl: ${FIRECRAWL_API_KEY ? '✅ configured' : '❌ missing'}`);
  console.log(`   ElevenLabs: ${ELEVENLABS_API_KEY ? '✅ configured' : '❌ missing'}\n`);
});
