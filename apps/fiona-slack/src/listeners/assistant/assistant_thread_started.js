/**
 * The `assistant_thread_started` event is sent when a user opens the Assistant container.
 * This can happen via DM with the app or as a side-container within a channel.
 *
 * @param {Object} params
 * @param {import("@slack/types").AssistantThreadStartedEvent} params.event - The assistant thread started event.
 * @param {import("@slack/logger").Logger} params.logger - Logger instance.
 * @param {import("@slack/bolt").SayFn} params.say - Function to send messages.
 * @param {Function} params.setSuggestedPrompts - Function to set suggested prompts.
 * @param {Function} params.saveThreadContext - Function to save thread context.
 *
 * @see {@link https://docs.slack.dev/reference/events/assistant_thread_started}
 */
export const assistantThreadStarted = async ({ event, logger, say, setSuggestedPrompts, saveThreadContext }) => {
  const context = event.assistant_thread?.context ?? null;

  try {
    /**
     * Since context is not sent along with individual user messages, it's necessary to keep
     * track of the context of the conversation to better assist the user. Sending an initial
     * message to the user with context metadata facilitates this, and allows us to update it
     * whenever the user changes context (via the `assistant_thread_context_changed` event).
     * The `say` utility sends this metadata along automatically behind the scenes.
     */
    await say('Hi, how can I help?');

    await saveThreadContext();

    /**
     * Provide the user up to 4 optional, preset prompts to choose from.
     * Suggested prompts are shown only when the assistant is opened in a DM
     * (no channel context), since channel threads already have surrounding context.
     *
     * The first `title` prop is an optional label above the prompts that
     * defaults to 'Try these prompts:' if not provided.
     *
     * @see {@link https://docs.slack.dev/reference/methods/assistant.threads.setSuggestedPrompts}
     */
    if (!context?.channel_id) {
      await setSuggestedPrompts({
        title: 'Start with a suggested prompt:',
        prompts: [
          {
            title: 'Get started with the ODS/API',
            message: 'How do I set up the Ed-Fi ODS/API for the first time?',
          },
          {
            title: 'Learn about Data Standard 6.0',
            message: "What's new in Ed-Fi Data Standard 6.0?",
          },
          {
            title: 'Configure Admin Console',
            message: 'How do I configure the Ed-Fi Admin Console?',
          },
          {
            title: 'Student entity required fields',
            message: 'What are the required fields for the Student entity in the Ed-Fi data model?',
          },
        ],
      });
    }
  } catch (e) {
    logger.error(e);
  }
};
