/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Telegraf } from 'telegraf';
import * as dotenv from 'dotenv';
import process from 'node:process';
import {
  Config,
  GeminiClient,
  Scheduler,
  GeminiEventType,
  ROOT_SCHEDULER_ID,
  debugLogger,
} from '@google/gemini-cli-core';
import type { Part } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import type { ToolCallRequestInfo } from '@google/gemini-cli-core';

dotenv.config();

const botToken = process.env['TELEGRAM_BOT_TOKEN'];
const geminiApiKey = process.env['GEMINI_API_KEY'];

if (!botToken) {
  debugLogger.error('TELEGRAM_BOT_TOKEN is not set');
  process.exit(1);
}

if (!geminiApiKey) {
  debugLogger.error('GEMINI_API_KEY is not set');
  process.exit(1);
}

// Map to store GeminiClient and Scheduler per chat
const sessions = new Map<
  number,
  { client: GeminiClient; scheduler: Scheduler; config: Config }
>();

const bot = new Telegraf(botToken);

async function getOrCreateSession(chatId: number) {
  const existing = sessions.get(chatId);
  if (existing) {
    return existing;
  }

  const sessionId = uuidv4();
  const config = new Config({
    sessionId,
    clientVersion: 'telegram-bot-0.1.0',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'gemini-2.0-flash', // Default model
    interactive: false,
  });

  // Set API Key in environment so core can pick it up
  process.env['GEMINI_API_KEY'] = geminiApiKey;

  const client = new GeminiClient(config);
  await client.initialize();

  const scheduler = new Scheduler({
    config,
    messageBus: config.getMessageBus(),
    getPreferredEditor: () => undefined,
    schedulerId: ROOT_SCHEDULER_ID,
  });

  const session = { client, scheduler, config };
  sessions.set(chatId, session);
  return session;
}

bot.start((ctx) => {
  void ctx.reply(
    'Welcome to Gemini CLI Telegram Bot! Send me a message to start chatting.',
  );
});

bot.help((ctx) => {
  void ctx.reply(
    'Commands:\n/reset - Reset the chat session\n/help - Show this help message',
  );
});

bot.command('reset', async (ctx) => {
  const chatId = ctx.chat.id;
  const session = sessions.get(chatId);
  if (session) {
    await session.client.resetChat();
    sessions.delete(chatId);
    await ctx.reply('Chat session has been reset.');
  } else {
    await ctx.reply('No active session to reset.');
  }
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  const chatId = ctx.chat.id;

  try {
    const { client, scheduler, config } = await getOrCreateSession(chatId);

    await ctx.sendChatAction('typing');

    let responseText = '';

    const processMessages = async (parts: Part[]) => {
      const responseStream = client.sendMessageStream(
        parts,
        new AbortController().signal,
        uuidv4(), // unique prompt id for this turn
      );

      const toolCallRequests: ToolCallRequestInfo[] = [];

      for await (const event of responseStream) {
        if (event.type === GeminiEventType.Content) {
          responseText += event.value;
        } else if (event.type === GeminiEventType.ToolCallRequest) {
          toolCallRequests.push(event.value);
        } else if (event.type === GeminiEventType.Error) {
          throw event.value.error;
        }
      }

      if (toolCallRequests.length > 0) {
        // Optionally notify user about tool execution
        // await ctx.reply('⏳ Executing tools...');

        const completedToolCalls = await scheduler.schedule(
          toolCallRequests,
          new AbortController().signal,
        );

        const toolResponseParts: Part[] = completedToolCalls.flatMap(
          (tc) => tc.response.responseParts || [],
        );

        // Record tool calls
        const currentModel =
          client.getCurrentSequenceModel() ?? config.getModel();
        client
          .getChat()
          .recordCompletedToolCalls(currentModel, completedToolCalls);

        // Continue the conversation with tool results
        await processMessages(toolResponseParts);
      }
    };

    await processMessages([{ text }]);

    if (responseText.trim()) {
      // Split message if it's too long for Telegram (4096 chars)
      const maxLength = 4000;
      if (responseText.length > maxLength) {
        for (let i = 0; i < responseText.length; i += maxLength) {
          await ctx.reply(responseText.substring(i, i + maxLength));
        }
      } else {
        await ctx.reply(responseText);
      }
    } else {
      await ctx.reply('Gemini returned an empty response.');
    }
  } catch (error) {
    debugLogger.error(`Error handling message: ${error}`);
    const errorMessage = error instanceof Error ? error.message : String(error);
    await ctx.reply(`❌ An error occurred: ${errorMessage}`);
  }
});

bot
  .launch()
  .then(() => {
    debugLogger.log('Gemini Telegram Bot is running...');
  })
  .catch((err) => {
    debugLogger.error(`Failed to launch bot: ${err}`);
  });

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
