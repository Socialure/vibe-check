/**
 * update-webhook-url.js — Update the ElevenLabs tool webhook URL after deployment
 *
 * Usage: NEW_URL=https://your-app.onrender.com node update-webhook-url.js
 */

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const TOOL_ID = 'tool_8601km4fzxk6e5qazvgxe8yswehx';
const NEW_URL = process.env.NEW_URL;

if (!ELEVENLABS_API_KEY) {
  console.error('❌ Set ELEVENLABS_API_KEY');
  process.exit(1);
}
if (!NEW_URL) {
  console.error('❌ Set NEW_URL (e.g., NEW_URL=https://your-app.onrender.com)');
  process.exit(1);
}

const webhookUrl = `${NEW_URL.replace(/\/$/, '')}/api/vibe-check`;

async function update() {
  console.log(`🔄 Updating webhook URL to: ${webhookUrl}`);

  const res = await fetch(`https://api.elevenlabs.io/v1/convai/tools/${TOOL_ID}`, {
    method: 'PATCH',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      tool_config: {
        type: 'webhook',
        name: 'vibe_check_search',
        description: 'Search the internet for the latest buzz, reviews, opinions, and news about a brand or product. Call this IMMEDIATELY when the user mentions ANY brand, product, or company. Always use this tool before delivering a vibe check.',
        response_timeout_secs: 30,
        force_pre_tool_speech: true,
        api_schema: {
          url: webhookUrl,
          method: 'POST',
          content_type: 'application/json',
          request_body_schema: {
            type: 'object',
            required: ['brand', 'mode'],
            properties: {
              brand: {
                type: 'string',
                description: 'The brand, product, or company name to search for'
              },
              mode: {
                type: 'string',
                description: 'The vibe check mode: roast for brutal/funny critique, or hype for enthusiastic praise.',
                enum: ['roast', 'hype']
              }
            }
          }
        }
      }
    })
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('❌ Failed:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log(`✅ Webhook URL updated to: ${data.tool_config?.api_schema?.url}`);
}

update().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
