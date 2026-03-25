/**
 * The `feedbackActionCallback` action responds to the `feedbackBlock` that displays
 * positive and negative feedback icons. This block is attached to the bottom of LLM
 * responses using the `WebClient#chatStream.stop()` method.
 *
 * @param {Object} params
 * @param {import("@slack/bolt").AckFn<any>} params.ack - Acknowledgement function.
 * @param {import("@slack/bolt").SlackAction} params.body - Action payload.
 * @param {import("@slack/web-api").WebClient} params.client - Slack web client.
 * @param {import("@slack/logger").Logger} params.logger - Logger instance.
 */
import { recordFeedback } from '../../agent/feedback-store.js';

export const feedbackActionCallback = async ({ ack, body, client, logger }) => {
  try {
    await ack();

    if (body.type !== 'block_actions' || !Array.isArray(body.actions) || body.actions.length === 0) {
      return;
    }

    const action = body.actions[0];
    if (action.type !== 'feedback_buttons') {
      return;
    }

    const message_ts = body.message.ts;
    const channel_id = body.channel.id;
    const user_id = body.user.id;
    const value = action.value;

    if (value === 'good-feedback') {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        thread_ts: message_ts,
        text: "We're glad you found this useful.",
      });
    } else if (value === 'bad-feedback') {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        thread_ts: message_ts,
        text: "Sorry to hear that response wasn't up to par :slightly_frowning_face: Starting a new chat may help with AI mistakes and hallucinations.",
      });
    } else {
      logger.warn('Received unexpected feedback value', {
        value,
        channel_id,
        user_id,
        message_ts,
      });
      return;
    }

    try {
      const botResponse = body.message.text ?? null;

      let userMessage = null;
      const thread_ts = body.message.thread_ts ?? message_ts;
      const { messages } = await client.conversations.replies({ channel: channel_id, ts: thread_ts });
      if (messages) {
        const botIndex = messages.findIndex((m) => m.ts === message_ts);
        const preceding = botIndex > 0 ? messages[botIndex - 1] : null;
        if (preceding?.text) userMessage = preceding.text;
      }

      await recordFeedback({
        userId: user_id,
        channelId: channel_id,
        messageTs: message_ts,
        value,
        userMessage,
        botResponse,
        logger,
      });
    } catch (e) {
      logger.error('Failed to record feedback to Cosmos DB:', e);
    }
  } catch (error) {
    logger.error('Something went wrong while handling feedback action.', error);
  }
};
