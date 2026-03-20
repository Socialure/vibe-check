import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// Load agent config for signed URL generation
let AGENT_ID;
try {
  const agentConfig = JSON.parse(readFileSync(join(__dirname, 'agent-config.json'), 'utf-8'));
  AGENT_ID = agentConfig.agent_id;
} catch (e) {
  console.warn('⚠️ agent-config.json not found — signed URL endpoint disabled');
}

// ── Active session tracking (single-user demo) ─────────────────────
let activeSession = null;

// ── SSE clients ─────────────────────────────────────────────────────
const sseClients = new Map();

app.get('/api/stream/:sessionId', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('data: {"type":"connected"}\n\n');
  sseClients.set(req.params.sessionId, res);
  req.on('close', () => sseClients.delete(req.params.sessionId));
});

function emit(sessionId, event) {
  const client = sseClients.get(sessionId);
  if (client) {
    client.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

// ── Start session (called by frontend before widget starts) ─────────
app.post('/api/start-session', (req, res) => {
  const { sessionId, topic } = req.body;
  activeSession = { sessionId, topic, results: [], phasesDone: [], startTime: Date.now() };
  console.log(`\n🎯 Session started: "${topic}" (${sessionId})`);
  emit(sessionId, { type: 'phase', phase: 'opening', message: `Initializing Vibe Check for "${topic}"...` });
  res.json({ ok: true });
});

// ── Firecrawl Search ────────────────────────────────────────────────
async function firecrawlSearch(query, limit = 5) {
  try {
    console.log(`  🔍 Firecrawl query: "${query}"`);
    const res = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        limit,
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true, timeout: 15000 },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`  ❌ Firecrawl ${res.status}: ${errText.substring(0, 200)}`);
      return [];
    }
    const data = await res.json();
    console.log(`  ✅ Firecrawl returned ${(data.data || []).length} results`);
    return data.data || [];
  } catch (e) {
    console.error('  ❌ Firecrawl error:', e.message);
    return [];
  }
}

// ── Quick sentiment analysis ────────────────────────────────────────
function analyzeSentiment(results) {
  const text = results
    .map(r => `${r.title || ''} ${r.description || ''} ${(r.markdown || '').substring(0, 300)}`)
    .join(' ')
    .toLowerCase();

  const posWords = ['love', 'amazing', 'great', 'excellent', 'best', 'innovative', 'recommend', 'fantastic', 'awesome', 'outstanding'];
  const negWords = ['hate', 'terrible', 'awful', 'worst', 'scam', 'trash', 'disappointed', 'horrible', 'broken', 'buggy'];

  let pos = 0, neg = 0;
  posWords.forEach(w => { if (text.includes(w)) pos++; });
  negWords.forEach(w => { if (text.includes(w)) neg++; });

  if (pos > neg * 2) return 'Overwhelmingly positive';
  if (pos > neg) return 'Mostly positive';
  if (neg > pos * 2) return 'Overwhelmingly negative';
  if (neg > pos) return 'Mostly negative';
  if (pos === 0 && neg === 0) return 'Neutral — not much strong opinion';
  return 'Mixed — divided opinions';
}

// ── Vibe Score Formula ──────────────────────────────────────────────
function calculateVibeScore(allResults) {
  const text = allResults
    .map(r => `${r.title || ''} ${r.description || ''} ${(r.markdown || '').substring(0, 600)}`)
    .join(' ')
    .toLowerCase();

  const posWords = [
    'love', 'amazing', 'great', 'excellent', 'best', 'innovative',
    'recommend', 'fantastic', 'awesome', 'outstanding', 'reliable',
    'brilliant', 'impressive', 'beautiful', 'solid', 'popular',
    'growing', 'praised', 'favorite', 'top-rated', 'quality',
  ];
  const negWords = [
    'hate', 'terrible', 'awful', 'worst', 'scam', 'trash',
    'disappointed', 'horrible', 'bad', 'broken', 'overpriced', 'buggy',
    'frustrating', 'misleading', 'ripoff', 'overrated', 'mediocre', 'boring',
    'slow', 'fail', 'sucks', 'cheap', 'waste', 'annoying', 'useless',
    'problem', 'issue', 'complaint', 'angry', 'toxic', 'cringe',
    'dead', 'dying', 'decline', 'worse', 'negative', 'concerned',
  ];
  const controversyWords = [
    'lawsuit', 'scandal', 'controversy', 'fired', 'layoff',
    'data breach', 'recall', 'investigation', 'fraud', 'sued',
    'accused', 'violation', 'penalty', 'ban', 'protest', 'backlash',
  ];
  const enthusiasmWords = [
    'game-changer', 'must-have', 'life-changing', 'addicted',
    'obsessed', 'never going back', 'best ever', 'mind-blowing',
    'revolutionary', 'groundbreaking', 'incredible',
  ];

  let posHits = 0, negHits = 0, controversyHits = 0, enthusiasmHits = 0;
  posWords.forEach(w => {
    const m = text.match(new RegExp(`\\b${w}\\b`, 'g'));
    if (m) posHits += m.length;
  });
  negWords.forEach(w => {
    const m = text.match(new RegExp(`\\b${w}\\b`, 'g'));
    if (m) negHits += m.length;
  });
  controversyWords.forEach(w => { if (text.includes(w)) controversyHits++; });
  enthusiasmWords.forEach(w => { if (text.includes(w)) enthusiasmHits++; });

  const effectivePos = Math.min(posHits, 8) * 0.3 + Math.max(0, posHits - 8) * 0.03;
  const effectiveNeg = negHits * 0.45;

  let score = 5;
  score += effectivePos;
  score -= effectiveNeg;
  score -= controversyHits * 1.3;
  score += enthusiasmHits * 0.5;
  score += (Math.random() - 0.5) * 1.5;

  if (allResults.length < 4) score -= 1.5;
  if (allResults.length < 2) score -= 1.0;

  score = Math.max(1, Math.min(10, Math.round(score)));

  const hypeDeficiency = score <= 5
    ? -Math.round((1 - score / 10) * 100)
    : Math.round((score / 10) * 100);

  return { score, posHits, negHits, controversyHits, enthusiasmHits, isRoast: score <= 5, hypeDeficiency };
}

// ── Cringe/Praise Triggers ──────────────────────────────────────────
function extractTriggers(allResults, isRoast) {
  const text = allResults
    .map(r => `${r.title || ''} ${(r.markdown || '').substring(0, 400)}`)
    .join(' ')
    .toLowerCase();

  if (isRoast) {
    const triggers = [];
    if (text.match(/overpriced|expensive|cost|price/)) triggers.push('Overpriced');
    if (text.match(/slow|lag|wait|loading/)) triggers.push('Performance Issues');
    if (text.match(/bug|crash|broken|glitch/)) triggers.push('Buggy Experience');
    if (text.match(/customer service|support|response/)) triggers.push('Poor Support');
    if (text.match(/boring|bland|generic|basic/)) triggers.push('Generic & Boring');
    if (text.match(/misleading|false|lie|fake/)) triggers.push('Misleading Claims');
    if (text.match(/privacy|data|tracking/)) triggers.push('Privacy Concerns');
    if (text.match(/copycat|clone|rip.?off/)) triggers.push('Unoriginal');
    if (text.match(/decline|falling|worse|downhill/)) triggers.push('Declining Quality');
    if (triggers.length === 0) triggers.push('Mid Energy', 'Nothing Special', 'Forgettable');
    return triggers.slice(0, 4);
  } else {
    const triggers = [];
    if (text.match(/innovative|innovation|new|fresh/)) triggers.push('Innovation');
    if (text.match(/community|fans|loyal|passionate/)) triggers.push('Strong Community');
    if (text.match(/quality|premium|well.?made|crafted/)) triggers.push('Premium Quality');
    if (text.match(/design|beautiful|aesthetic|clean/)) triggers.push('Great Design');
    if (text.match(/fast|quick|performance|efficient/)) triggers.push('High Performance');
    if (text.match(/value|affordable|worth|deal/)) triggers.push('Great Value');
    if (text.match(/reliable|trust|consistent|dependable/)) triggers.push('Reliable');
    if (text.match(/growing|momentum|trending|viral/)) triggers.push('Trending Up');
    if (triggers.length === 0) triggers.push('Positive Buzz', 'Good Vibes', 'People Approve');
    return triggers.slice(0, 4);
  }
}

// ── Agent Webhook — called by ElevenLabs Conversational Agent ───────
// The agent calls this tool in phases: reviews → reddit → news → deep_dive → verdict
// Each call returns text that the agent's LLM uses to generate narration
app.post('/api/agent-search', async (req, res) => {
  // Log full body for debugging ElevenLabs webhook format
  console.log(`\n🤖 Agent webhook received:`, JSON.stringify(req.body).substring(0, 500));

  // ElevenLabs may nest parameters differently — extract brand/phase flexibly
  let brand = req.body.brand;
  let phase = req.body.phase;

  // If ElevenLabs wraps in a "parameters" object
  if (!brand && req.body.parameters) {
    brand = req.body.parameters.brand;
    phase = req.body.parameters.phase;
  }

  // If brand/phase still missing, try to find them anywhere in the body
  if (!brand) {
    brand = activeSession?.topic || 'unknown';
    console.log(`  ⚠️ No brand in request, using session topic: "${brand}"`);
  }
  if (!phase) {
    phase = 'reviews';
    console.log(`  ⚠️ No phase in request, defaulting to: "${phase}"`);
  }

  console.log(`  → brand="${brand}", phase="${phase}"`);

  // If no active session, create one (agent started before frontend)
  if (!activeSession) {
    const fallbackSid = 'agent-' + Date.now();
    activeSession = { sessionId: fallbackSid, topic: brand, results: [], phasesDone: [], startTime: Date.now() };
    console.log(`  ⚠️ No active session — created fallback: ${fallbackSid}`);
  }

  const { sessionId } = activeSession;
  const quotedBrand = `"${brand}"`;

  // Phase configs
  const searchConfigs = {
    reviews: { query: `${quotedBrand} review opinion latest 2025 2026`, label: 'Reviews & Coverage', limit: 5 },
    reddit: { query: `${quotedBrand} reddit think opinion honest review`, label: 'Reddit & Forums', limit: 5 },
    news: { query: `${quotedBrand} news controversy drama latest`, label: 'News & Drama', limit: 5 },
    deep_dive: { query: `${quotedBrand} twitter social media trending sentiment`, label: 'Social Media Deep Dive', limit: 4 },
  };

  // ── VERDICT phase ──
  if (phase === 'verdict') {
    emit(sessionId, { type: 'phase', phase: 'analyzing', message: 'Calculating Vibe Index...' });

    const analysis = calculateVibeScore(activeSession.results);
    const mode = analysis.isRoast ? 'roast' : 'hype';
    const triggers = extractTriggers(activeSession.results, analysis.isRoast);

    console.log(`  📊 Score: ${analysis.score}/10 (${mode}), +${analysis.posHits}/-${analysis.negHits}`);

    emit(sessionId, {
      type: 'score_reveal',
      score: analysis.score,
      isRoast: analysis.isRoast,
      mode,
      hypeDeficiency: analysis.hypeDeficiency,
      triggers,
    });

    // Send complete event after a delay (give agent time to speak verdict)
    setTimeout(() => {
      const elapsed = ((Date.now() - activeSession.startTime) / 1000).toFixed(1);
      emit(sessionId, {
        type: 'complete',
        topic: brand,
        score: analysis.score,
        mode,
        verdict: '', // Agent speaks this dynamically
        triggers,
        hypeDeficiency: analysis.hypeDeficiency,
        sources: activeSession.results.map(r => ({ title: r.title, url: r.url })).filter(s => s.url).slice(0, 10),
        totalResults: activeSession.results.length,
        elapsed: parseFloat(elapsed),
        stats: {
          posHits: analysis.posHits,
          negHits: analysis.negHits,
          controversyHits: analysis.controversyHits,
          enthusiasmHits: analysis.enthusiasmHits,
        },
      });
    }, 8000); // 8s delay so agent can speak the verdict before screen transitions

    const verdictResponse = [
      `FINAL VIBE SCORE CALCULATION for ${brand}:`,
      `Score: ${analysis.score} out of 10`,
      `Mode: ${mode.toUpperCase()}`,
      `Positive signals found: ${analysis.posHits}`,
      `Negative signals found: ${analysis.negHits}`,
      `Controversy signals: ${analysis.controversyHits}`,
      `Enthusiasm signals: ${analysis.enthusiasmHits}`,
      `Total sources analyzed: ${activeSession.results.length}`,
      `${analysis.isRoast ? 'Key Weaknesses' : 'Key Strengths'}: ${triggers.join(', ')}`,
      ``,
      `YOUR TASK: Deliver the FINAL VERDICT as a 4-6 sentence monologue.`,
      `The score is ${analysis.score} out of 10 — this is ${mode.toUpperCase()} MODE.`,
      analysis.isRoast
        ? `Be entertainingly brutal. Channel your inner Simon Cowell. Reference specific evidence you found in earlier searches. Be savage but funny.`
        : `Be genuinely enthusiastic. Channel maximum hype energy. Reference specific positive findings from the searches. Make it infectious.`,
      `State the final score clearly: "${analysis.score} out of 10."`,
      `End with a memorable, quotable mic-drop line.`,
    ].join('\n');

    return res.json({ response: verdictResponse });
  }

  // ── SEARCH phases ──
  const config = searchConfigs[phase];
  if (!config) {
    return res.json({
      response: `Unknown phase "${phase}". Valid phases: reviews, reddit, news, deep_dive, verdict. Start with "reviews".`,
    });
  }

  emit(sessionId, { type: 'phase', phase, message: `Searching ${config.label} for "${brand}"...` });

  const results = await firecrawlSearch(config.query, config.limit);
  activeSession.results.push(...results);
  activeSession.phasesDone.push(phase);

  // Send search results to frontend for visual display
  emit(sessionId, {
    type: 'search_done',
    label: config.label,
    count: results.length,
    titles: results.slice(0, 4).map(r => r.title || r.url || 'Untitled'),
  });

  // Build rich text response for the agent's LLM
  const summaries = results.slice(0, 5).map(r => {
    const title = r.title || 'Untitled';
    const snippet = (r.description || (r.markdown || '').substring(0, 150)).substring(0, 200);
    return `- "${title}": ${snippet}`;
  }).join('\n');

  const sentiment = analyzeSentiment(results);

  const nextPhases = { reviews: 'reddit', reddit: 'news', news: 'deep_dive', deep_dive: 'verdict' };
  const nextPhase = nextPhases[phase];

  const phaseNames = { reviews: 'Reviews & Coverage', reddit: 'Reddit & Forums', news: 'News & Drama', deep_dive: 'Social Media' };

  const responseText = [
    `SEARCH RESULTS — ${phaseNames[phase]} (${results.length} results found):`,
    results.length === 0 ? 'No results found for this search.' : summaries,
    ``,
    `Overall sentiment: ${sentiment}`,
    `Total sources collected so far: ${activeSession.results.length}`,
    ``,
    `YOUR TASK: React to these ${phaseNames[phase]} findings in 2-3 SHORT punchy sentences. Be specific — reference titles or sentiments you see.`,
    `Then IMMEDIATELY call vibe_check_search again with brand="${brand}" and phase="${nextPhase}" to continue the investigation.`,
    nextPhase === 'verdict'
      ? `The next call will calculate the final score. Build anticipation!`
      : `Keep the energy up — you're building toward the final verdict.`,
  ].join('\n');

  return res.json({ response: responseText });
});

// ── Legacy endpoint (fallback) ──────────────────────────────────────
app.post('/api/vibe-check', async (req, res) => {
  const { topic, sessionId } = req.body;
  if (!topic) return res.status(400).json({ error: 'Topic required' });
  // Just start a session — the agent will do the actual searching
  activeSession = { sessionId, topic, results: [], phasesDone: [], startTime: Date.now() };
  console.log(`\n🎯 Legacy start: "${topic}" (${sessionId})`);
  res.json({ sessionId, status: 'started' });
});

// ── Signed URL for client-side ElevenLabs agent connection ───────────
app.get('/api/signed-url', async (req, res) => {
  if (!AGENT_ID || !ELEVENLABS_API_KEY) {
    return res.status(500).json({ error: 'Agent not configured' });
  }
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${AGENT_ID}`,
      { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
    );
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`❌ Signed URL failed (${response.status}): ${errText.substring(0, 200)}`);
      return res.status(response.status).json({ error: 'Failed to get signed URL' });
    }
    const data = await response.json();
    console.log('🔑 Signed URL generated for agent conversation');
    res.json(data);
  } catch (e) {
    console.error('❌ Signed URL error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Health ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'vibe-check-v3-agent',
    firecrawl: !!FIRECRAWL_API_KEY,
    elevenlabs: !!ELEVENLABS_API_KEY,
    activeSession: activeSession ? { topic: activeSession.topic, phases: activeSession.phasesDone } : null,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🎙️  Vibe Check V3 (Agent Mode) on port ${PORT}`);
  console.log(`   Firecrawl: ${FIRECRAWL_API_KEY ? '✅' : '❌'}`);
  console.log(`   ElevenLabs: ${ELEVENLABS_API_KEY ? '✅' : '❌'}`);
  console.log(`   Agent webhook: /api/agent-search\n`);
});
