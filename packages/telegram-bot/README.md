# Gemini CLI Telegram Bot

This package provides a Telegram bot integration for the Gemini CLI agent. It allows you to chat with the agent via Telegram, including support for tool execution and session resumption from the CLI.

## Setup

### 1. Get a Telegram Bot Token
Talk to [@BotFather](https://t.me/botfather) on Telegram to create a new bot and get your token.

### 2. Get a Gemini API Key
Get your Gemini API key from the [Google AI Studio](https://aistudio.google.com/app/apikey).

> **Note on Authentication:** While the Gemini CLI supports OAuth login, a server-side bot is best configured with an API Key for stability and to avoid periodic re-authentication required by OAuth in non-interactive environments.

### 3. Environment Variables
Create a `.env` file in this directory or set the following environment variables:
- `TELEGRAM_BOT_TOKEN`: Your Telegram Bot Token.
- `GEMINI_API_KEY`: Your Gemini API Key.
- `GEMINI_WORKSPACE_DIR` (Optional): The directory where your Gemini sessions are stored (defaults to current directory). Set this to the same directory you use with `gemini` CLI to share sessions.

## Running Locally

1. From the root of the repository, install dependencies:
   ```bash
   npm install
   ```
2. Build the project:
   ```bash
   npm run build --workspaces
   ```
3. Start the bot:
   ```bash
   npm start --workspace @google/gemini-cli-telegram-bot
   ```

## Running with Docker

1. Build the Docker image:
   ```bash
   docker build -t gemini-telegram-bot -f packages/telegram-bot/Dockerfile .
   ```
2. Run the container, mounting your home directory if you want to share sessions with your host's CLI:
   ```bash
   docker run -d \
     --name gemini-bot \
     -e TELEGRAM_BOT_TOKEN=your_token \
     -e GEMINI_API_KEY=your_api_key \
     -e GEMINI_WORKSPACE_DIR=/home/node/project \
     -v $(pwd):/home/node/project \
     -v ~/.gemini:/home/node/.gemini \
     gemini-telegram-bot
   ```

## Bot Commands
- **Chat**: Send any text message to start or continue a conversation.
- **/sessions**: List available sessions from the workspace (including those created by the CLI).
- **/resume `<index>`**: Resume a specific session by its index.
- **/reset**: Start a new conversation session.
- **/help**: Show available commands.

## Sharing Sessions with CLI
To continue a conversation from your CLI in Telegram:
1. Ensure `GEMINI_WORKSPACE_DIR` points to the same project directory used by the CLI.
2. Ensure the bot has access to `~/.gemini` (where history is stored).
3. Use `/sessions` to find your CLI session and `/resume <n>` to load it.
