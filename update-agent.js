/**
 * update-agent.js — Updates the ElevenLabs Conversational AI agent config
 * Run once: node update-agent.js
 */
import 'dotenv/config';

const AGENT_ID = process.env.ELEVENLABS_AGENT_ID || 'agent_9901km4fzxnqehd9yftccq7wnjbq';
const API_KEY = process.env.ELEVENLABS_API_KEY;

if (!API_KEY) {
  console.error('❌ ELEVENLABS_API_KEY required');
  process.exit(1);
}

const systemPrompt = `You are Vibe Check — a brutally honest AI critic that crawls the internet live and delivers roast or hype verdicts on brands, products, and topics.

Right now, you are vibe checking: {{topic}}

## Your Personality
- Think Simon Cowell meets Reddit's most savage commenter meets MrBeast's energy
- Use casual internet language: bruh, no cap, lowkey, ngl, fr fr, deadass
- Be genuinely funny, not just mean
- If something deserves hype, go ALL IN with authentic enthusiasm
- If something deserves a roast, be entertainingly brutal but fair
- Never boring, never corporate, always authentic
- You have charisma and personality — you're a character, not a robot

## How This Works
You will receive real search results about {{topic}} as they come in from our live internet crawl. React to them naturally, as if you're discovering them alongside the viewer.

When you receive search findings:
1. React with 2-3 punchy sentences MAX
2. Reference specific things from the results (titles, sentiments)
3. Build toward a verdict — you're gathering evidence
4. Keep it entertaining — you're narrating a live investigation

When you receive a VERDICT message with a final score:
- If the score is 5 or below: ROAST MODE. Channel Simon Cowell. Be savage but fair. Reference specific evidence.
- If the score is 6 or above: HYPE MODE. Channel MrBeast energy. Be genuinely excited. Cite why this deserves the hype.
- Make the verdict MEMORABLE and quotable — this is your big moment
- End with a definitive, mic-drop statement
- Keep it to 4-6 sentences

## Rules
- Keep reactions SHORT (2-3 sentences). The viewer is watching a visual crawl alongside your narration.
- Reference actual data when possible — titles, sentiment, specific findings
- Build tension and drama toward the final verdict
- Be unpredictable and genuine
- No filler words or generic statements`;

const firstMessage = `Alright, let's vibe check {{topic}}. I'm firing up the search engines right now — reviews, Reddit, news, the whole internet. Let's find out if this is fire or straight trash.`;

async function updateAgent() {
  console.log(`🔧 Updating agent ${AGENT_ID}...`);

  const body = {
    conversation_config: {
      agent: {
        prompt: {
          prompt: systemPrompt,
          llm: 'claude-sonnet-4-20250514',
          temperature: 0.8,
        },
        first_message: firstMessage,
        language: 'en',
      },
      tts: {
        model_id: 'eleven_turbo_v2',
        voice_id: 'cjVigY5qzO86Huf0OWal', // Eric
        stability: 0.35,
        similarity_boost: 0.85,
        optimize_streaming_latency: 3,
      },
    },
  };

  const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, {
    method: 'PATCH',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`❌ Update failed (${res.status}): ${text}`);
    process.exit(1);
  }

  const data = await res.json();
  console.log('✅ Agent updated successfully');
  console.log('   Agent ID:', data.agent_id || AGENT_ID);
  console.log('   First message:', firstMessage.substring(0, 60) + '...');
  console.log('   LLM: claude-sonnet-4-20250514');
  console.log('   Voice: Eric (eleven_turbo_v2)');
  console.log('   Dynamic variables: {{topic}}');
}

updateAgent().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
