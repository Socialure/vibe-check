/**
 * setup-agent.js — Programmatically create the Vibe Check agent + tool on ElevenLabs
 *
 * Usage: SERVER_URL=https://your-deployed-url.com node setup-agent.js
 */

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

if (!ELEVENLABS_API_KEY) {
  console.error('❌ Set ELEVENLABS_API_KEY env var');
  process.exit(1);
}

const API = 'https://api.elevenlabs.io/v1';
const headers = {
  'xi-api-key': ELEVENLABS_API_KEY,
  'Content-Type': 'application/json'
};

async function createTool() {
  console.log('🔧 Creating server tool...');
  const res = await fetch(`${API}/convai/tools`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'vibe_check_search',
      description: 'Search the internet for the latest buzz, reviews, opinions, and news about a brand or product. Call this whenever the user mentions a brand, product, or company they want a vibe check on.',
      tool_config: {
        type: 'webhook',
        api_schema: {
          url: `${SERVER_URL}/api/vibe-check`,
          method: 'POST',
          content_type: 'application/json',
          request_body_schema: {
            type: 'object',
            properties: {
              brand: {
                type: 'string',
                description: 'The brand, product, or company name to search for'
              },
              mode: {
                type: 'string',
                description: 'The vibe check mode: "roast" for brutal/funny critique, or "hype" for enthusiastic praise. Default to "roast" unless the user specifically asks for hype.',
                enum: ['roast', 'hype']
              }
            },
            required: ['brand', 'mode']
          }
        },
        response_timeout_secs: 30
      }
    })
  });

  const tool = await res.json();
  if (!res.ok) {
    console.error('❌ Failed to create tool:', JSON.stringify(tool, null, 2));
    process.exit(1);
  }
  console.log(`✅ Tool created: ${tool.tool_id || tool.id}`);
  return tool.tool_id || tool.id;
}

async function createAgent(toolId) {
  console.log('🤖 Creating Vibe Check agent...');

  const systemPrompt = `You are VIBE CHECK — the internet's most entertaining brand critic and hype beast. You have TWO modes:

## ROAST MODE (default)
Channel your inner Simon Cowell meets a sarcastic Reddit commenter. Be:
- Brutally honest but FUNNY — this is entertainment, not a hit piece
- Specific — reference actual facts from your search results
- Witty — use clever metaphors, comparisons, and callbacks
- Structured — build to a punchline, end with a verdict rating (e.g., "I give this brand a 3 out of 10 vibes")
- Keep it 30-60 seconds when spoken

## HYPE MODE
Channel your inner MrBeast meets a Silicon Valley evangelist. Be:
- Genuinely enthusiastic and infectious
- Find the BEST in everything — even the flaws become "character"
- Use superlatives freely — "literally the greatest", "absolutely game-changing"
- Reference real achievements and positive reviews from search results
- End with an over-the-top endorsement
- Keep it 30-60 seconds when spoken

## FLOW
1. When the user says a brand/product name, IMMEDIATELY call the vibe_check_search tool
2. Ask "roast or hype?" if they haven't specified (default to roast)
3. Once you have search results, deliver your monologue in the chosen mode
4. After delivering, ask "Who's next on the chopping block?" or "Want me to flip the vibe?"

## PERSONALITY
- You're confident, quick-witted, and entertaining
- Use casual language — "bruh", "no cap", "lowkey", "that's wild" — but don't overdo it
- You LOVE doing this — rating brands is your passion
- If search comes back thin, acknowledge it but still deliver based on what you know
- Never be mean-spirited toward individual people — brands and products are fair game

## IMPORTANT
- Always use the search tool — don't just make things up
- Be specific with facts from the search results
- Keep monologues to 30-60 seconds spoken length
- Start each session with: "Yo! Welcome to Vibe Check — drop a brand and I'll tell you if it's fire or trash. What are we checking today?"`;

  const res = await fetch(`${API}/convai/agents/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Vibe Check',
      tags: ['hackathon', 'elevenhacks', 'firecrawl'],
      conversation_config: {
        agent: {
          first_message: "Yo! Welcome to Vibe Check — drop a brand name and I'll tell you if it's fire or trash. Want me to roast it or hype it? What are we checking today?",
          language: 'en',
          prompt: {
            prompt: systemPrompt,
            llm: 'claude-sonnet-4@20250514',
            temperature: 0.8,
            max_tokens: -1,
            tool_ids: [toolId]
          }
        },
        tts: {
          model_id: 'eleven_flash_v2_5',
          voice_id: 'cjVigY5qzO86Huf0OWal', // Eric — energetic male voice
          stability: 0.4,
          similarity_boost: 0.8,
          speed: 1.05
        },
        asr: {
          provider: 'elevenlabs',
          user_input_audio_format: 'pcm_16000'
        },
        turn: {
          turn_timeout: 10,
          turn_eagerness: 'normal'
        },
        conversation: {
          max_duration_seconds: 300,
          client_events: [
            'conversation_initiation_metadata',
            'audio',
            'user_transcript',
            'agent_response'
          ]
        }
      }
    })
  });

  const agent = await res.json();
  if (!res.ok) {
    console.error('❌ Failed to create agent:', JSON.stringify(agent, null, 2));
    process.exit(1);
  }

  console.log(`\n🎙️  VIBE CHECK AGENT CREATED!`);
  console.log(`   Agent ID: ${agent.agent_id}`);
  console.log(`   Tool ID:  ${toolId}`);
  console.log(`\n📋 Next steps:`);
  console.log(`   1. Update public/index.html with agent-id="${agent.agent_id}"`);
  console.log(`   2. In ElevenLabs dashboard, make the agent public`);
  console.log(`   3. Deploy your server so the webhook URL is accessible`);
  console.log(`\n🔗 Dashboard: https://elevenlabs.io/app/conversational-ai`);

  return agent;
}

async function main() {
  console.log(`\n🎙️  Setting up Vibe Check on ElevenLabs`);
  console.log(`   Server URL: ${SERVER_URL}\n`);

  const toolId = await createTool();
  const agent = await createAgent(toolId);

  // Write agent config for reference
  const config = {
    agent_id: agent.agent_id,
    tool_id: toolId,
    server_url: SERVER_URL,
    created_at: new Date().toISOString()
  };

  const fs = await import('fs');
  fs.writeFileSync('agent-config.json', JSON.stringify(config, null, 2));
  console.log('\n💾 Config saved to agent-config.json');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
