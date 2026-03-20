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
const VOICE_ID = 'cjVigY5qzO86Huf0OWal'; // Eric voice

// ── SSE: Live search activity feed ──────────────────────────────────
const sseClients = new Map(); // sessionId -> res

app.get('/api/activity/:sessionId', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('data: {"type":"connected"}\n\n');
  sseClients.set(req.params.sessionId, res);
  req.on('close', () => sseClients.delete(req.params.sessionId));
});

function broadcastToSession(sessionId, event) {
  const client = sseClients.get(sessionId);
  if (client) {
    client.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

// ── Firecrawl Search ──────────────────────────────────────────────────
async function firecrawlSearch(query, limit = 5, label = '', sessionId = '') {
  broadcastToSession(sessionId, { type: 'search_start', query, label });

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
    broadcastToSession(sessionId, { type: 'search_error', query, label, error: `HTTP ${res.status}` });
    return [];
  }

  const data = await res.json();
  const results = data.data?.web || data.data || [];

  broadcastToSession(sessionId, {
    type: 'search_done',
    query,
    label,
    count: results.length,
    titles: results.slice(0, 4).map(r => r.title || r.url || 'Untitled'),
  });

  return results;
}

// ── Build search context for a topic ──────────────────────────────────
async function buildTopicContext(topic, sessionId) {
  broadcastToSession(sessionId, { type: 'crawl_start', topic });

  const [general, opinions, news] = await Promise.all([
    firecrawlSearch(`${topic} review 2025 2026`, 4, '📰 Reviews', sessionId),
    firecrawlSearch(`${topic} reddit opinions complaints praise`, 3, '💬 Opinions', sessionId),
    firecrawlSearch(`${topic} latest news controversy`, 3, '🔥 News', sessionId),
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

  const allResults = [...general, ...opinions, ...news];
  const totalResults = allResults.length;

  broadcastToSession(sessionId, { type: 'crawl_done', topic, totalResults });

  return {
    context: `# Live Internet Research for "${topic}"

## General Reviews & Info
${formatResults(general, 'Reviews')}

## Public Opinions (Reddit, Forums)
${formatResults(opinions, 'Opinions')}

## Latest News
${formatResults(news, 'News')}`,
    totalResults,
    sources: allResults.map(r => ({ title: r.title, url: r.url })).filter(s => s.url),
  };
}

// ── Sentiment Analysis & Score ────────────────────────────────────────
function analyzeContent(context, topic) {
  const lower = context.toLowerCase();

  const positiveWords = ['love', 'amazing', 'great', 'excellent', 'best', 'innovative', 'impressed',
    'recommend', 'fantastic', 'perfect', 'awesome', 'outstanding', 'wonderful', 'incredible',
    'revolutionary', 'game-changer', 'beautiful', 'solid', 'reliable', 'popular', 'growing',
    'success', 'praised', 'favorite', 'top-rated', 'breakthrough', 'premium', 'quality'];

  const negativeWords = ['hate', 'terrible', 'awful', 'worst', 'scam', 'trash', 'disappointed',
    'avoid', 'horrible', 'bad', 'broken', 'overpriced', 'slow', 'buggy', 'lawsuit', 'scandal',
    'controversy', 'failing', 'decline', 'complaints', 'frustrating', 'misleading', 'ripoff',
    'overrated', 'mediocre', 'problem', 'issue', 'crash', 'toxic', 'fired', 'layoff'];

  let posCount = 0, negCount = 0;
  positiveWords.forEach(w => { const matches = lower.match(new RegExp(`\\b${w}\\b`, 'gi')); if (matches) posCount += matches.length; });
  negativeWords.forEach(w => { const matches = lower.match(new RegExp(`\\b${w}\\b`, 'gi')); if (matches) negCount += matches.length; });

  const total = posCount + negCount || 1;
  const posRatio = posCount / total;

  // Score 1-10 based on sentiment ratio
  const rawScore = Math.round(posRatio * 10);
  const score = Math.max(1, Math.min(10, rawScore));

  // Extract key facts (sentences containing the topic)
  const sentences = context.split(/[.!?\n]/).filter(s =>
    s.toLowerCase().includes(topic.toLowerCase().split(' ')[0]) && s.trim().length > 20
  ).slice(0, 8);

  return { score, posCount, negCount, posRatio, sentences };
}

// ── Generate Verdict Text ─────────────────────────────────────────────
function generateVerdict(topic, analysis, mode) {
  const { score, sentences, posCount, negCount } = analysis;
  const facts = sentences.slice(0, 4).map(s => s.trim()).filter(Boolean);

  if (mode === 'roast') {
    const intros = [
      `Oh, ${topic}. Where do I even begin.`,
      `Alright, let's talk about ${topic}. Buckle up.`,
      `${topic}. I did my research, and... yikes.`,
      `So someone asked me to vibe check ${topic}. Here we go.`,
      `${topic}? Really? You want me to dig into THIS?`,
    ];
    const outros = [
      `My verdict? ${score} out of 10. ${score <= 4 ? 'Absolute dumpster fire.' : score <= 6 ? 'Mid. Painfully, aggressively mid.' : 'Not terrible, but I expected worse.'}`,
      `Final score: ${score} out of 10. ${score <= 4 ? 'Delete your account.' : score <= 6 ? 'It exists. That is the nicest thing I can say.' : 'Fine. You win this round.'}`,
    ];

    let middle = '';
    if (facts.length > 0) {
      middle = `Here is what the internet is saying. ${facts[0]}. `;
      if (facts.length > 1) middle += `And get this — ${facts[1]}. `;
      if (negCount > posCount) middle += `The complaints are STACKING UP. People are NOT happy. `;
      else middle += `People are somehow still defending this. Wild. `;
    } else {
      middle = `I searched the entire internet and honestly, barely anyone is even talking about this. That might be the biggest roast of all. `;
    }

    return `${intros[Math.floor(Math.random() * intros.length)]} ${middle}${outros[Math.floor(Math.random() * outros.length)]}`;
  } else {
    // Hype mode
    const intros = [
      `${topic}! Now THIS is what I am talking about!`,
      `Let me tell you about ${topic}. The vibes are IMMACULATE.`,
      `OK so ${topic}? I just crawled the entire internet and I am HYPED.`,
      `${topic}! The people have spoken and the energy is INCREDIBLE!`,
    ];
    const outros = [
      `My verdict? ${score} out of 10! ${score >= 7 ? 'Absolute fire! Go all in!' : score >= 5 ? 'Solid vibes. Getting there!' : 'It has got potential! Keep pushing!'}`,
      `Final score: ${score} out of 10! ${score >= 7 ? 'This is the real deal. Jump on it!' : score >= 5 ? 'Good foundation, great energy building!' : 'The comeback story is WRITING ITSELF!'}`,
    ];

    let middle = '';
    if (facts.length > 0) {
      middle = `Check this out — ${facts[0]}. `;
      if (facts.length > 1) middle += `AND — ${facts[1]}. `;
      if (posCount > negCount) middle += `The love is REAL. People are raving about this! `;
      else middle += `And the best part? There is so much room to grow! `;
    } else {
      middle = `This is a hidden gem! The internet has not caught on yet, which means YOU are early! `;
    }

    return `${intros[Math.floor(Math.random() * intros.length)]} ${middle}${outros[Math.floor(Math.random() * outros.length)]}`;
  }
}

// ── ElevenLabs Text-to-Speech ─────────────────────────────────────────
async function generateSpeech(text) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2',
      voice_settings: {
        stability: 0.35,
        similarity_boost: 0.85,
        style: 0.7,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('ElevenLabs TTS error:', res.status, err);
    return null;
  }

  const audioBuffer = await res.arrayBuffer();
  return Buffer.from(audioBuffer).toString('base64');
}

// ── Main Vibe Check Endpoint ──────────────────────────────────────────
app.post('/api/vibe-check', async (req, res) => {
  const startTime = Date.now();
  const { topic, mode = 'roast', sessionId } = req.body;

  if (!topic) {
    return res.status(400).json({ error: 'Topic is required' });
  }

  console.log(`🎯 Vibe Check: "${topic}" in ${mode} mode (session: ${sessionId})`);

  try {
    // 1. Crawl the internet
    broadcastToSession(sessionId, { type: 'status', message: 'Searching the internet...', phase: 'crawl' });
    const { context, totalResults, sources } = await buildTopicContext(topic, sessionId);

    // 2. Analyze & generate verdict
    broadcastToSession(sessionId, { type: 'status', message: 'Analyzing vibes...', phase: 'analyze' });
    const analysis = analyzeContent(context, topic);
    const verdictText = generateVerdict(topic, analysis, mode);
    const score = analysis.score;

    console.log(`📊 Score: ${score}/10, Pos: ${analysis.posCount}, Neg: ${analysis.negCount}`);

    // 3. Generate speech
    broadcastToSession(sessionId, { type: 'status', message: 'Generating voice...', phase: 'speech' });
    const audioBase64 = await generateSpeech(verdictText);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Vibe Check complete in ${elapsed}s`);

    broadcastToSession(sessionId, { type: 'status', message: 'Done!', phase: 'done' });

    res.json({
      topic,
      mode,
      score,
      verdict: verdictText,
      audio: audioBase64, // base64 mp3
      sources: sources.slice(0, 6),
      totalResults,
      elapsed: parseFloat(elapsed),
    });
  } catch (err) {
    console.error('❌ Vibe Check error:', err.message);
    broadcastToSession(sessionId, { type: 'status', message: 'Error!', phase: 'error' });
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

// ── Start server ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🎙️  Vibe Check server running on port ${PORT}`);
  console.log(`   API:     http://localhost:${PORT}/api/vibe-check`);
  console.log(`   Health:  http://localhost:${PORT}/api/health`);
  console.log(`   Firecrawl: ${FIRECRAWL_API_KEY ? '✅ configured' : '❌ missing'}`);
  console.log(`   ElevenLabs: ${ELEVENLABS_API_KEY ? '✅ configured' : '❌ missing'}\n`);
});
