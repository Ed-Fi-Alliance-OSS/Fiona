import { callLLM } from '../../agent/llm-caller.js';
import { checkRateLimit } from '../../agent/rate-limiter.js';
import { buildThreadHistory } from '../../agent/thread-history.js';
import { feedbackBlock } from '../views/feedback_block.js';

/**
 * Handles when users send messages or select a prompt in an assistant thread
 * and generate AI responses.
 *
 * @param {Object} params
 * @param {import("@slack/web-api").WebClient} params.client - Slack web client.
 * @param {import("@slack/bolt").Context} params.context - Event context.
 * @param {import("@slack/logger").Logger} params.logger - Logger instance.
 * @param {import("@slack/types").MessageEvent} params.message - The incoming message.
 * @param {import("@slack/bolt").SayFn} params.say - Function to send messages.
 * @param {Function} params.setStatus - Function to set assistant status.
 *
 * @see {@link https://docs.slack.dev/reference/events/message}
 */
export const message = async ({ client, context, logger, message, say, setStatus }) => {
  /**
   * Messages sent to the Assistant can have a specific message subtype.
   *
   * Here we check that the message was sent to a thread to skip unexpected
   * message subtypes.
   *
   * @see {@link https://docs.slack.dev/reference/events/message#subtypes}
   */
  if (!('thread_ts' in message) || !message.thread_ts) {
    return;
  }

  /**
   * When a user sends an empty message (or one that only contains Slack mention
   * tokens such as `<@U0AJYKA5S4D>`), respond with a helpful introduction
   * rather than silently ignoring the message or forwarding an empty prompt.
   */
  const text = ('text' in message ? message.text || '' : '').replace(/<[@#!][^>]+>/g, '').trim();
  if (!text) {
    try {
      await say(
        "Hi, I'm Fiona, your Ed-Fi AI assistant! Ask me anything about Ed-Fi standards, documentation, or implementations.",
      );
    } catch (e) {
      logger.error('Failed to send introduction message:', e);
    }
    return;
  }

  try {
    const { channel, thread_ts } = message;
    const { userId, teamId } = context;

    const { allowed, retryAfterMs } = checkRateLimit(userId);
    if (!allowed) {
      const minutes = Math.ceil(retryAfterMs / 60000);
      await say(
        `:no_entry: You've reached the request limit. Please wait ${minutes} minute${minutes !== 1 ? 's' : ''} before trying again.`,
      );
      return;
    }

    // Set status while the LLM processes the request
    await setStatus({
      status: 'thinking...',
      loading_messages: [
        'Teaching the hamsters to type faster…',
        'Untangling the internet cables…',
        'Consulting the office goldfish…',
        'Polishing up the response just for you…',
        'Convincing the AI to stop overthinking…',
      ],
    });

    const streamer = client.chatStream({
      channel: channel,
      recipient_team_id: teamId,
      recipient_user_id: userId,
      thread_ts: thread_ts,
      task_display_mode: 'timeline',
    });

    const prompts = await buildThreadHistory(client, channel, thread_ts, { currentText: text, logger });

    await callLLM(streamer, prompts, logger);
    await streamer.stop({ blocks: [feedbackBlock] });
  } catch (e) {
    logger.error('Failed to handle a user message event:', e);
    await say(':warning: Something went wrong! Please try again later.');
  }
};
