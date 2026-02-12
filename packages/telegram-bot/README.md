# Gemini CLI Telegram Bot

This package provides a Telegram bot integration for the Gemini CLI agent. It allows you to chat with the agent via Telegram, including support for tool execution.

## Setup

### 1. Get a Telegram Bot Token
Talk to [@BotFather](https://t.me/botfather) on Telegram to create a new bot and get your token.

### 2. Get a Gemini API Key
Get your Gemini API key from the [Google AI Studio](https://aistudio.google.com/app/apikey).

### 3. Environment Variables
Create a `.env` file in this directory or set the following environment variables:
- `TELEGRAM_BOT_TOKEN`: Your Telegram Bot Token.
- `GEMINI_API_KEY`: Your Gemini API Key.

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
2. Run the container:
   ```bash
   docker run -d \
     --name gemini-bot \
     -e TELEGRAM_BOT_TOKEN=your_token \
     -e GEMINI_API_KEY=your_api_key \
     gemini-telegram-bot
   ```

## Features
- **Chat**: Send any text message to start a conversation.
- **Tools**: The agent can use built-in tools (like file system access, shell, etc.) if configured. Note: By default, it uses the current directory of the bot as its workspace.
- **Reset**: Use `/reset` to clear the current conversation session.
