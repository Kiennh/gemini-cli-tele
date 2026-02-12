/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Telegraf } from 'telegraf';
import * as dotenv from 'dotenv';
import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  Config,
  GeminiClient,
  Scheduler,
  GeminiEventType,
  ROOT_SCHEDULER_ID,
  debugLogger,
  SESSION_FILE_PREFIX,
  partListUnionToString,
} from '@google/gemini-cli-core';
import type { Part } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import type {
  ToolCallRequestInfo,
  ConversationRecord,
  MessageRecord,
} from '@google/gemini-cli-core';

dotenv.config();

const botToken = process.env['TELEGRAM_BOT_TOKEN'];
const geminiApiKey = process.env['GEMINI_API_KEY'];
const workspaceDir = path.resolve(
  process.env['GEMINI_WORKSPACE_DIR'] || process.cwd(),
);

if (!botToken) {
  debugLogger.error('TELEGRAM_BOT_TOKEN is not set');
  process.exit(1);
}

if (!geminiApiKey) {
  debugLogger.warn(
    'GEMINI_API_KEY is not set. The bot will attempt to use existing CLI authentication.',
  );
}

// Map to store GeminiClient and Scheduler per chat
const sessions = new Map<
  number,
  { client: GeminiClient; scheduler: Scheduler; config: Config }
>();

const bot = new Telegraf(botToken);

async function createGeminiSession(
  chatId: number,
  options: {
    sessionId?: string;
    history?: Array<{ role: 'user' | 'model'; parts: Part[] }>;
    resumedData?: { conversation: ConversationRecord; filePath: string };
  } = {},
) {
  const sessionId = options.sessionId || uuidv4();
  const config = new Config({
    sessionId,
    clientVersion: 'telegram-bot-0.1.0',
    targetDir: workspaceDir,
    cwd: workspaceDir,
    debugMode: false,
    model: 'gemini-2.0-flash', // Default model
    interactive: false,
  });

  // Set API Key in environment if provided
  if (geminiApiKey) {
    process.env['GEMINI_API_KEY'] = geminiApiKey;
  }

  await config.initialize();
  const client = new GeminiClient(config);

  if (options.history) {
    await client.resumeChat(options.history, options.resumedData);
  } else {
    await client.initialize();
  }

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

async function getOrCreateSession(chatId: number) {
  const existing = sessions.get(chatId);
  if (existing) {
    return existing;
  }
  return createGeminiSession(chatId);
}

bot.start((ctx) => {
  void ctx.reply(
    `Welcome to Gemini CLI Telegram Bot!\nConnected to: ${workspaceDir}\n\nCommands:\n/sessions - List available sessions\n/resume <index> - Resume a session\n/reset - Start a new session`,
  );
});

bot.help((ctx) => {
  void ctx.reply(
    'Commands:\n/sessions - List available sessions\n/resume <index> - Resume a session\n/reset - Start a new session\n/help - Show this help message',
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
    await ctx.reply('Starting a new session.');
  }
  await getOrCreateSession(chatId);
});

bot.command('sessions', async (ctx) => {
  try {
    const config = new Config({
      sessionId: 'temp',
      targetDir: workspaceDir,
      cwd: workspaceDir,
      debugMode: false,
      model: 'gemini-2.0-flash',
    });
    await config.initialize();

    const chatsDir = path.join(config.storage.getProjectTempDir(), 'chats');
    const files = await fs.readdir(chatsDir).catch(() => []);
    const sessionFiles = files
      .filter((f) => f.startsWith(SESSION_FILE_PREFIX) && f.endsWith('.json'))
      .sort();

    if (sessionFiles.length === 0) {
      await ctx.reply(`No previous sessions found in ${workspaceDir}`);
      return;
    }

    const list = [];
    for (let i = 0; i < sessionFiles.length; i++) {
      const filePath = path.join(chatsDir, sessionFiles[i]);
      const contentStr = await fs.readFile(filePath, 'utf8');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const content = JSON.parse(contentStr) as ConversationRecord;
      const firstMsg = content.messages[0] as MessageRecord | undefined;
      const summary =
        content.summary ||
        (firstMsg
          ? partListUnionToString(firstMsg.content).substring(0, 50) + '...'
          : 'No content');
      list.push(`${i + 1}. ${summary}`);
    }

    const message = `Available sessions (last 10):\n${list.reverse().slice(0, 10).join('\n')}`;
    await ctx.reply(message);
  } catch (error) {
    debugLogger.error(`Error listing sessions: ${error}`);
    await ctx.reply('Failed to list sessions.');
  }
});

bot.command('resume', async (ctx) => {
  const chatId = ctx.chat.id;
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    await ctx.reply('Please provide a session index. Example: /resume 1');
    return;
  }

  const index = parseInt(args[1], 10) - 1;

  try {
    const config = new Config({
      sessionId: 'temp',
      targetDir: workspaceDir,
      cwd: workspaceDir,
      debugMode: false,
      model: 'gemini-2.0-flash',
    });
    await config.initialize();

    const chatsDir = path.join(config.storage.getProjectTempDir(), 'chats');
    const files = (await fs.readdir(chatsDir).catch(() => []))
      .filter((f) => f.startsWith(SESSION_FILE_PREFIX) && f.endsWith('.json'))
      .sort();

    if (index < 0 || index >= files.length) {
      await ctx.reply('Invalid session index.');
      return;
    }

    // reverse list because we displayed it reversed in /sessions
    const reversedFiles = [...files].reverse();
    const sessionFile = reversedFiles[index];
    const filePath = path.join(chatsDir, sessionFile);
    const contentStr = await fs.readFile(filePath, 'utf8');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const conversation = JSON.parse(contentStr) as ConversationRecord;

    // Simplified conversion logic
    const clientHistory: Array<{ role: 'user' | 'model'; parts: Part[] }> = [];
    for (const msg of conversation.messages) {
      if (msg.type === 'user' || msg.type === 'gemini') {
        const role = msg.type === 'user' ? 'user' : 'model';
        let parts: Part[];
        if (Array.isArray(msg.content)) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          parts = msg.content as Part[];
        } else {
          parts = [{ text: partListUnionToString(msg.content) }];
        }

        clientHistory.push({
          role,
          parts,
        });
      }
    }

    await createGeminiSession(chatId, {
      sessionId: conversation.sessionId,
      history: clientHistory,
      resumedData: { conversation, filePath },
    });

    await ctx.reply(`Resumed session: ${conversation.summary || 'Untitled'}`);
  } catch (error) {
    debugLogger.error(`Error resuming session: ${error}`);
    await ctx.reply('Failed to resume session.');
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
    debugLogger.log(`Workspace: ${workspaceDir}`);
  })
  .catch((err) => {
    debugLogger.error(`Failed to launch bot: ${err}`);
  });

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
