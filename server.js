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

// ── SSE clients ──────────────────────────────────────────────────────
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

// ── Firecrawl Search ─────────────────────────────────────────────────
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

// ── ElevenLabs TTS ───────────────────────────────────────────────────
async function generateSpeech(text) {
  if (!ELEVENLABS_API_KEY) {
    console.log('  ⚠️  No ElevenLabs key — skipping TTS');
    return null;
  }
  try {
    console.log(`  🎙️  TTS generating (${text.length} chars)...`);
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
          stability: 0.28,
          similarity_boost: 0.85,
          style: 0.8,
          use_speaker_boost: true,
        },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`  ❌ TTS ${res.status}: ${errText.substring(0, 200)}`);
      return null;
    }
    const buf = await res.arrayBuffer();
    console.log(`  ✅ TTS generated (${buf.byteLength} bytes)`);
    return Buffer.from(buf).toString('base64');
  } catch (e) {
    console.error('  ❌ TTS error:', e.message);
    return null;
  }
}

// ── Vibe Score Formula ───────────────────────────────────────────────
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

// ── Narration Generator ──────────────────────────────────────────────
function makeNarration(phase, topic, results, analysis) {
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const topTitles = results.slice(0, 3).map(r => r.title || 'an article').join(', ');

  switch (phase) {
    case 'opening':
      return pick([
        `Alright, let's vibe check ${topic}. I'm about to crawl the entire internet, reviews, Reddit, news, everything, to find out if this is fire or straight trash. Here we go.`,
        `OK so someone wants me to vibe check ${topic}. Let me fire up the search engines and see what the internet really thinks. No sugar coating, no mercy. Let's dig in.`,
        `${topic}, huh? Let me pull up everything the internet has to say about this. Reviews, hot takes, drama, all of it. Buckle up, this is Vibe Check.`,
      ]);

    case 'reviews':
      if (results.length === 0) return `Hmm, I'm pulling up reviews for ${topic} and there's barely anything here. When the internet doesn't have opinions, that's usually not a great sign. Let me keep digging though.`;
      return pick([
        `First up, reviews. I found ${results.length} results including ${topTitles}. Let me scan through these and see what the consensus is. Some interesting stuff here already.`,
        `OK so the review landscape for ${topic}. Found ${results.length} articles including ${topTitles}. Interesting. Let me read between the lines here and see what people are really saying.`,
      ]);

    case 'opinions': {
      if (results.length === 0) return `Reddit and the forums are dead silent on ${topic}. When the internet doesn't care enough to argue about something, that tells you a lot. Moving on to the news.`;
      const hasNeg = results.some(r => (r.markdown || '').toLowerCase().match(/hate|awful|terrible|worst|scam|trash|sucks/));
      const hasPos = results.some(r => (r.markdown || '').toLowerCase().match(/love|amazing|best|incredible|awesome|obsessed/));
      if (hasNeg && hasPos) return `Now Reddit and the forums. This is where it gets interesting. People are DIVIDED on ${topic}. Some absolutely love it, others are tearing it apart. Found ${results.length} discussion threads. This is the kind of drama I live for. Let me factor all of this in.`;
      if (hasNeg) return `OK so Reddit and the forums. And wow. People are NOT happy with ${topic}. I'm seeing some seriously negative takes here across ${results.length} threads. The complaints are stacking up. This is going to hurt the score for sure.`;
      if (hasPos) return `Checking Reddit and the forums now. And people are actually pretty positive about ${topic}! I found ${results.length} threads with genuine enthusiasm, not just marketing fluff. That's a really good sign actually.`;
      return `Reddit has ${results.length} threads about ${topic}. Mixed vibes so far. Some fans, some skeptics. Let me factor this into the analysis and keep going.`;
    }

    case 'news': {
      const hasDrama = results.some(r =>
        (r.title || '').toLowerCase().match(/scandal|controversy|lawsuit|fired|layoff|breach|protest|backlash/)
      );
      if (hasDrama) return `Oh oh oh. The news has DRAMA. I'm seeing controversy, headlines that are NOT flattering for ${topic}. This is definitely going to tank the vibe score. Let me dig deeper and see how bad this really is.`;
      if (results.length === 0) return `Checking the news cycle for ${topic}. It's quiet. No drama, but also no buzz. Sometimes the absence of news IS the news. Let me do one more deep scan before the verdict.`;
      return `Latest news on ${topic}. Found ${results.length} articles. The news coverage is looking ${results.length > 3 ? 'pretty active' : 'relatively quiet'}. No major scandals, which is a plus. Almost ready for the final analysis now.`;
    }

    case 'deep_dive': {
      if (results.length === 0) return `One final deep scan across social media and I'm not finding much more on ${topic}. OK, I think I have enough data now. Let me crunch all the numbers and calculate the final vibe score.`;
      return `One last pass, going deeper into social media for ${topic}. Found ${results.length} more data points. I'm looking at trends, mentions, the whole picture. This is where I finalize my assessment. Give me a second to calculate everything.`;
    }

    case 'verdict_roast': {
      const { score } = analysis;
      const intro = pick([
        `OK, I've seen enough. Time for the verdict.`,
        `The data is in, and I have to be honest with you.`,
        `After crawling the entire internet, here's my take.`,
      ]);
      const verdicts = {
        1: `This is a ${score} out of 10. An absolute catastrophe. I found almost nothing positive. The internet has collectively decided this is NOT it. If this were a restaurant, the health department would shut it down. Delete everything and start over.`,
        2: `A ${score} out of 10. Yikes. The vibes are BAD. Reviews are tanking, forums are roasting this harder than I ever could, and the news isn't helping. This needs serious CPR.`,
        3: `${score} out of 10. Not great, not great at all. There are some serious recurring complaints that people keep bringing up. The hype train left the station without this one.`,
        4: `${score} out of 10. Below average. It's not a complete trainwreck, but nobody's excited either. Mediocrity might be the cruelest roast of all, you're not even interesting enough to hate.`,
        5: `${score} out of 10. Dead center. Aggressively, painfully mid. Not bad enough to be entertaining, not good enough to recommend. The lukewarm latte of the internet. The beige paint of brands. The elevator music of products.`,
      };
      return `${intro} ${verdicts[score] || verdicts[5]}`;
    }

    case 'verdict_hype': {
      const { score } = analysis;
      const intro = pick([
        `The results are in, and I am genuinely impressed!`,
        `After scanning everything, here's my verdict, and it's a GOOD one!`,
        `OK so the internet has spoken, and the vibes are STRONG!`,
      ]);
      const verdicts = {
        6: `${score} out of 10! There's real positive energy building here. Not perfect yet, but the trajectory is pointing up. People are starting to notice, and the sentiment is trending positive. Keep pushing, this could go big.`,
        7: `${score} out of 10! Solid hype! People are genuinely enthusiastic about this. The reviews are positive, Reddit is defending it, and there's real momentum building. This is the kind of organic buzz that money can't buy.`,
        8: `${score} out of 10! The love is REAL! I'm seeing praise across reviews, forums, and social media. People aren't just liking this, they're recommending it to others. That's the gold standard of hype.`,
        9: `${score} out of 10! Nearly perfect! The internet is borderline obsessed. Reviews are glowing, the community is passionate, and the buzz is off the charts. This is elite territory. Hard to find anything bad to say.`,
        10: `A perfect ${score} out of 10! LEGENDARY status! I literally could not find meaningful criticism. The internet is in LOVE. Reviews are stellar, the community is thriving, and the hype is fully justified. This is as good as it gets.`,
      };
      return `${intro} ${verdicts[score] || verdicts[7]}`;
    }

    default:
      return '';
  }
}

// ── Cringe/Praise Triggers ───────────────────────────────────────────
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

// ── Utility: wait ────────────────────────────────────────────────────
const wait = ms => new Promise(r => setTimeout(r, ms));

// ── Main Vibe Check (async pipeline) ─────────────────────────────────
app.post('/api/vibe-check', async (req, res) => {
  const { topic, sessionId } = req.body;
  if (!topic) return res.status(400).json({ error: 'Topic required' });

  console.log(`\n🎯 Vibe Check: "${topic}" (session: ${sessionId})`);
  res.json({ sessionId, status: 'started' });

  runVibeCheck(topic, sessionId).catch(err => {
    console.error('❌ Vibe Check error:', err);
    emit(sessionId, { type: 'error', message: err.message });
  });
});

async function runVibeCheck(topic, sessionId) {
  const allResults = [];
  const startTime = Date.now();

  // Use the exact topic for searches — quote it to prevent partial matching
  const quotedTopic = `"${topic}"`;

  // ── Phase 1: Opening narration ──
  emit(sessionId, { type: 'phase', phase: 'opening', message: `Initializing Vibe Check for "${topic}"...` });
  const openingText = makeNarration('opening', topic, [], null);
  emit(sessionId, { type: 'narration', text: openingText, phase: 'opening' });
  const openingAudio = await generateSpeech(openingText);
  if (openingAudio) {
    emit(sessionId, { type: 'audio', audio: openingAudio, phase: 'opening' });
    // Wait for approximate audio duration so client can play it
    // ~150 words per minute for TTS, ~0.8s per word, rough estimate
    const wordCount = openingText.split(/\s+/).length;
    const estimatedDuration = Math.max(4000, wordCount * 400);
    console.log(`  ⏳ Waiting ${estimatedDuration}ms for opening narration (${wordCount} words)`);
    await wait(estimatedDuration);
  }

  // ── Phase 2: Reviews ──
  emit(sessionId, { type: 'phase', phase: 'reviews', message: `Scanning reviews for "${topic}"...` });
  const reviews = await firecrawlSearch(`${quotedTopic} review opinion latest`, 5);
  allResults.push(...reviews);
  emit(sessionId, {
    type: 'search_done', label: 'Reviews & Coverage', count: reviews.length,
    titles: reviews.slice(0, 4).map(r => r.title || r.url || 'Untitled'),
  });
  // Small pause to let results render
  await wait(1500);
  const reviewText = makeNarration('reviews', topic, reviews, null);
  emit(sessionId, { type: 'narration', text: reviewText, phase: 'reviews' });
  const reviewAudio = await generateSpeech(reviewText);
  if (reviewAudio) {
    emit(sessionId, { type: 'audio', audio: reviewAudio, phase: 'reviews' });
    const wordCount = reviewText.split(/\s+/).length;
    const estimatedDuration = Math.max(4000, wordCount * 400);
    console.log(`  ⏳ Waiting ${estimatedDuration}ms for reviews narration (${wordCount} words)`);
    await wait(estimatedDuration);
  }

  // ── Phase 3: Reddit & Opinions ──
  emit(sessionId, { type: 'phase', phase: 'opinions', message: 'Crawling Reddit & forums...' });
  const opinions = await firecrawlSearch(`${quotedTopic} reddit think opinion honest review`, 5);
  allResults.push(...opinions);
  emit(sessionId, {
    type: 'search_done', label: 'Reddit & Forums', count: opinions.length,
    titles: opinions.slice(0, 4).map(r => r.title || r.url || 'Untitled'),
  });
  await wait(1500);
  const opinionText = makeNarration('opinions', topic, opinions, null);
  emit(sessionId, { type: 'narration', text: opinionText, phase: 'opinions' });
  const opinionAudio = await generateSpeech(opinionText);
  if (opinionAudio) {
    emit(sessionId, { type: 'audio', audio: opinionAudio, phase: 'opinions' });
    const wordCount = opinionText.split(/\s+/).length;
    const estimatedDuration = Math.max(4000, wordCount * 400);
    console.log(`  ⏳ Waiting ${estimatedDuration}ms for opinions narration (${wordCount} words)`);
    await wait(estimatedDuration);
  }

  // ── Phase 4: News & Controversy ──
  emit(sessionId, { type: 'phase', phase: 'news', message: 'Checking news & controversy...' });
  const news = await firecrawlSearch(`${quotedTopic} news controversy drama latest`, 5);
  allResults.push(...news);
  emit(sessionId, {
    type: 'search_done', label: 'News & Drama', count: news.length,
    titles: news.slice(0, 4).map(r => r.title || r.url || 'Untitled'),
  });
  await wait(1500);
  const newsText = makeNarration('news', topic, news, null);
  emit(sessionId, { type: 'narration', text: newsText, phase: 'news' });
  const newsAudio = await generateSpeech(newsText);
  if (newsAudio) {
    emit(sessionId, { type: 'audio', audio: newsAudio, phase: 'news' });
    const wordCount = newsText.split(/\s+/).length;
    const estimatedDuration = Math.max(4000, wordCount * 400);
    console.log(`  ⏳ Waiting ${estimatedDuration}ms for news narration (${wordCount} words)`);
    await wait(estimatedDuration);
  }

  // ── Phase 5: Deep Dive ──
  emit(sessionId, { type: 'phase', phase: 'deep_dive', message: 'Deep scanning social media...' });
  const deep = await firecrawlSearch(`${quotedTopic} twitter social media trending sentiment`, 4);
  allResults.push(...deep);
  emit(sessionId, {
    type: 'search_done', label: 'Social Media Deep Dive', count: deep.length,
    titles: deep.slice(0, 3).map(r => r.title || r.url || 'Untitled'),
  });
  await wait(1500);
  const deepText = makeNarration('deep_dive', topic, deep, null);
  emit(sessionId, { type: 'narration', text: deepText, phase: 'deep_dive' });
  const deepAudio = await generateSpeech(deepText);
  if (deepAudio) {
    emit(sessionId, { type: 'audio', audio: deepAudio, phase: 'deep_dive' });
    const wordCount = deepText.split(/\s+/).length;
    const estimatedDuration = Math.max(3000, wordCount * 400);
    console.log(`  ⏳ Waiting ${estimatedDuration}ms for deep dive narration (${wordCount} words)`);
    await wait(estimatedDuration);
  }

  // ── Phase 6: Calculate & Verdict ──
  emit(sessionId, { type: 'phase', phase: 'analyzing', message: 'Calculating Vibe Index...' });
  await wait(2000); // Dramatic pause

  const analysis = calculateVibeScore(allResults);
  const mode = analysis.isRoast ? 'roast' : 'hype';
  const triggers = extractTriggers(allResults, analysis.isRoast);

  console.log(`📊 Score: ${analysis.score}/10 (${mode}), +${analysis.posHits}/-${analysis.negHits}, controversy: ${analysis.controversyHits}`);

  emit(sessionId, {
    type: 'score_reveal',
    score: analysis.score,
    isRoast: analysis.isRoast,
    mode,
    hypeDeficiency: analysis.hypeDeficiency,
    triggers,
  });

  // Dramatic pause before verdict
  await wait(2500);

  const verdictPhase = analysis.isRoast ? 'verdict_roast' : 'verdict_hype';
  const verdictText = makeNarration(verdictPhase, topic, allResults, analysis);
  emit(sessionId, { type: 'narration', text: verdictText, phase: 'verdict' });
  const verdictAudio = await generateSpeech(verdictText);
  if (verdictAudio) {
    emit(sessionId, { type: 'audio', audio: verdictAudio, phase: 'verdict' });
    // Wait for verdict audio to play before sending complete
    const wordCount = verdictText.split(/\s+/).length;
    const estimatedDuration = Math.max(5000, wordCount * 400);
    console.log(`  ⏳ Waiting ${estimatedDuration}ms for verdict narration (${wordCount} words)`);
    await wait(estimatedDuration);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✅ Complete in ${elapsed}s — ${mode} ${analysis.score}/10`);

  emit(sessionId, {
    type: 'complete',
    topic,
    score: analysis.score,
    mode,
    verdict: verdictText,
    triggers,
    hypeDeficiency: analysis.hypeDeficiency,
    sources: allResults.map(r => ({ title: r.title, url: r.url })).filter(s => s.url).slice(0, 10),
    totalResults: allResults.length,
    elapsed: parseFloat(elapsed),
    stats: {
      posHits: analysis.posHits,
      negHits: analysis.negHits,
      controversyHits: analysis.controversyHits,
      enthusiasmHits: analysis.enthusiasmHits,
    },
  });
}

// ── Health ────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'vibe-check',
    firecrawl: !!FIRECRAWL_API_KEY,
    elevenlabs: !!ELEVENLABS_API_KEY,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🎙️  Vibe Check server on port ${PORT}`);
  console.log(`   Firecrawl: ${FIRECRAWL_API_KEY ? '✅' : '❌'}`);
  console.log(`   ElevenLabs: ${ELEVENLABS_API_KEY ? '✅' : '❌'}\n`);
});
