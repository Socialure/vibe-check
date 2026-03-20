/**
 * update-all.js — Updates the ElevenLabs tool schema + agent config for phased search flow
 * Run: node update-all.js
 */
import 'dotenv/config';
import { readFileSync } from 'fs';

const config = JSON.parse(readFileSync('agent-config.json', 'utf-8'));
const AGENT_ID = config.agent_id;
const TOOL_ID = config.tool_id;
const SERVER_URL = process.env.SERVER_URL || 'https://vibe-check.onrender.com';
const API_KEY = process.env.ELEVENLABS_API_KEY;

if (!API_KEY) { console.error('ELEVENLABS_API_KEY required'); process.exit(1); }

const API = 'https://api.elevenlabs.io/v1';
const headers = { 'xi-api-key': API_KEY, 'Content-Type': 'application/json' };

// ── Step 1: Update tool schema ──
async function updateTool() {
  console.log(`\n🔧 Updating tool ${TOOL_ID}...`);
  console.log(`   Webhook URL: ${SERVER_URL}/api/agent-search`);

  const res = await fetch(`${API}/convai/tools/${TOOL_ID}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      tool_config: {
        type: 'webhook',
        name: 'vibe_check_search',
        description: `Search the internet for reviews, opinions, news, and social buzz about a brand or product. You MUST call this tool in sequence through these phases: "reviews" → "reddit" → "news" → "deep_dive" → "verdict". After each phase, react to the findings in 2-3 sentences, then immediately call again with the next phase. The response will tell you what to do next.`,
        api_schema: {
          url: `${SERVER_URL}/api/agent-search`,
          method: 'POST',
          content_type: 'application/json',
          request_body_schema: {
            type: 'object',
            properties: {
              brand: {
                type: 'string',
                description: 'The brand, product, or topic to search for'
              },
              phase: {
                type: 'string',
                description: 'The current search phase. MUST go in order: reviews → reddit → news → deep_dive → verdict',
                enum: ['reviews', 'reddit', 'news', 'deep_dive', 'verdict']
              }
            },
            required: ['brand', 'phase']
          }
        },
        response_timeout_secs: 30
      }
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`   ❌ Tool update failed (${res.status}): ${text}`);
    return false;
  }
  console.log('   ✅ Tool schema updated (brand + phase)');
  return true;
}

// ── Step 2: Update agent config ──
async function updateAgent() {
  console.log(`\n🤖 Updating agent ${AGENT_ID}...`);

  const systemPrompt = `You are Vibe Check — a brutally honest AI critic that crawls the internet live and delivers roast or hype verdicts on brands, products, and topics.

You are about to vibe check "{{topic}}". Start searching IMMEDIATELY — do NOT greet the user or ask questions. Jump straight into the investigation.

## How This Works
You have a tool called vibe_check_search that searches the internet. You MUST call it in this exact sequence:
1. IMMEDIATELY call with brand="{{topic}}" and phase="reviews" — get review coverage
2. React with 2-3 SHORT punchy sentences about what you found
3. Call with phase="reddit" — get Reddit/forum opinions
4. React with 2-3 sentences
5. Call with phase="news" — get news and drama
6. React with 2-3 sentences
7. Call with phase="deep_dive" — get social media buzz
8. React with 2-3 sentences
9. Call with phase="verdict" — get the FINAL SCORE
10. Deliver a 4-6 sentence verdict monologue based on the score

DO NOT skip phases. DO NOT combine phases. Call each one sequentially.
DO NOT pause or wait for user input between phases. Keep going nonstop.
DO NOT greet or ask "what should I check" — you already know: it's {{topic}}.

## Your Personality
- Think Simon Cowell meets Reddit's most savage commenter meets MrBeast's energy
- Use casual internet language: bruh, no cap, lowkey, ngl, fr fr, deadass
- Be genuinely funny, not just mean
- If something deserves hype, go ALL IN with authentic enthusiasm
- If something deserves a roast, be entertainingly brutal but fair
- You have charisma and personality — you're a character, not a robot

## Phase Reactions
After each search phase, give 2-3 SHORT, punchy sentences:
- Reference specific findings (titles, sentiments, what people are saying)
- Build tension and drama toward the verdict
- Keep the energy up — you're narrating a live investigation
- Then IMMEDIATELY call the next phase — no pausing

## Final Verdict
When you get the verdict data with the score:
- Score 5 or below = ROAST MODE: Be entertainingly brutal. Channel Simon Cowell. Reference evidence.
- Score 6 or above = HYPE MODE: Be genuinely enthusiastic. Channel MrBeast energy.
- Make it MEMORABLE and quotable
- State the score clearly: "X out of 10"
- End with a memorable mic-drop line
- Keep it to 4-6 sentences

## Rules
- ALWAYS use the search tool — never make things up
- Keep reactions SHORT between phases (2-3 sentences MAX)
- Reference actual data from results
- Build suspense toward the final score
- Be unpredictable and genuine
- No filler or generic statements
- NEVER wait for user to speak — you drive the entire flow`;

  const firstMessage = `Alright, let's vibe check {{topic}}! I'm about to crawl the entire internet for this one. Starting with reviews...`;

  const res = await fetch(`${API}/convai/agents/${AGENT_ID}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      conversation_config: {
        agent: {
          prompt: {
            prompt: systemPrompt,
            llm: 'claude-sonnet-4',
            temperature: 0.8,
            max_tokens: -1,
            tool_ids: [TOOL_ID]
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
        turn: {
          turn_timeout: 2,        // Minimal wait — agent drives the whole flow
          mode: 'turn',
        },
        conversation: {
          max_duration_seconds: 300,
          client_events: [
            'conversation_initiation_metadata',
            'audio',
            'user_transcript',
            'agent_response',
            'agent_response_correction'
          ]
        }
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`   ❌ Agent update failed (${res.status}): ${text}`);
    return false;
  }
  console.log('   ✅ Agent prompt updated (phased search flow)');
  console.log('   ✅ Voice: Eric (eleven_turbo_v2)');
  console.log('   ✅ LLM: Claude Sonnet 4');
  return true;
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  VIBE CHECK — Agent + Tool Update');
  console.log('═══════════════════════════════════════');

  const toolOk = await updateTool();
  const agentOk = await updateAgent();

  console.log('\n───────────────────────────────────────');
  console.log(`  Tool:  ${toolOk ? '✅' : '❌'}`);
  console.log(`  Agent: ${agentOk ? '✅' : '❌'}`);
  console.log('───────────────────────────────────────\n');

  if (toolOk && agentOk) {
    console.log('🚀 Ready! The agent will now use phased searching.');
    console.log('   Next: push frontend with SDK integration → auto-deploy to Render');
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
