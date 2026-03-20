# 🎙️ Vibe Check — Is It Fire or Trash?

A voice AI agent that roasts or hypes any brand/product using live internet search. Say a brand name, and get a brutally honest roast or enthusiastic hype monologue powered by real-time web data.

**Built for [ElevenHacks #0](https://hacks.elevenlabs.io/)** · Powered by [ElevenLabs](https://elevenlabs.io) + [Firecrawl](https://firecrawl.dev)

## How It Works

1. 🎤 **You speak** a brand/product name → ElevenAgent transcribes it
2. 🔍 **Server webhook fires** → searches Firecrawl for latest reviews, Reddit opinions, news
3. 🧠 **LLM synthesizes** search results into a 30-60 second entertaining monologue
4. 🔊 **You hear** the vibe check in an energetic AI voice

## Two Modes

- **🔥 Roast Mode** — Simon Cowell meets Reddit. Brutal but funny verdicts.
- **🚀 Hype Mode** — MrBeast meets Silicon Valley. Finds the best in everything.

## Quick Start

```bash
# Clone
git clone https://github.com/Socialure/vibe-check.git
cd vibe-check

# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your API keys

# Create the ElevenLabs agent (one-time setup)
npm run setup

# Start the server
npm start
```

## Setup

### 1. Environment Variables

```
FIRECRAWL_API_KEY=fc-your-key
ELEVENLABS_API_KEY=sk_your-key
SERVER_URL=https://your-deployed-url.com  # or http://localhost:3000 for local dev
PORT=3000
```

### 2. Create the Agent

```bash
# This creates the ElevenLabs agent and webhook tool programmatically
SERVER_URL=https://your-deployed-url.com npm run setup
```

This will:
- Create a server-side webhook tool pointing to your backend
- Create the Vibe Check agent with the tool attached
- Save the agent ID to `agent-config.json`

### 3. Update the Frontend

After running setup, update `public/index.html` with the agent ID from the output (or from `agent-config.json`).

### 4. Deploy

Deploy to any Node.js host (Render, Railway, Vercel, etc.). The server needs to be publicly accessible for the ElevenLabs webhook.

## Architecture

```
┌─────────────────────────────────────────────┐
│                  User's Browser              │
│  ┌─────────────────────────────────────────┐ │
│  │    Vibe Check UI + ElevenLabs Widget    │ │
│  └────────────────┬────────────────────────┘ │
└───────────────────┼──────────────────────────┘
                    │ WebSocket/WebRTC
                    ▼
┌─────────────────────────────────────────────┐
│           ElevenLabs Platform               │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌────────┐  │
│  │ ASR  │→ │ LLM  │→ │ TTS  │→ │ Audio  │  │
│  └──────┘  └──┬───┘  └──────┘  └────────┘  │
└───────────────┼─────────────────────────────┘
                │ Webhook (POST)
                ▼
┌─────────────────────────────────────────────┐
│         Vibe Check Backend (Express)        │
│  ┌─────────────────────────────────────────┐ │
│  │  /api/vibe-check webhook endpoint       │ │
│  │  - Receives brand + mode                │ │
│  │  - Fires 3 parallel Firecrawl searches  │ │
│  │  - Returns formatted context            │ │
│  └────────────────┬────────────────────────┘ │
└───────────────────┼──────────────────────────┘
                    │ POST /v2/search
                    ▼
┌─────────────────────────────────────────────┐
│           Firecrawl Search API              │
│  - Reviews & ratings                        │
│  - Reddit opinions                          │
│  - Latest news & controversies              │
└─────────────────────────────────────────────┘
```

## Tech Stack

- **Backend**: Node.js, Express
- **Search**: Firecrawl Search API (live web + scrape)
- **Voice AI**: ElevenLabs Conversational AI (STT + LLM + TTS)
- **Frontend**: Vanilla HTML/CSS/JS with ElevenLabs widget embed

## License

MIT — Built by [Socialure](https://github.com/Socialure) for ElevenHacks #0
