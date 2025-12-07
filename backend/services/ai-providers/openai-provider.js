import { BaseAIProvider } from './base-provider.js';
import { logger } from '../../../logger.js';
import OpenAI from 'openai';

/**
 * OpenAI Provider Implementation
 */
export class OpenAIProvider extends BaseAIProvider {
  constructor(config) {
    super(config);
    this.name = 'OpenAI';
    this.model = config.ai?.openai?.model || 'gpt-4-turbo-preview';
    this.apiKey = config.ai?.openai?.apiKey;
    this.maxContextTokens = 8192; // GPT-4 Turbo context window

    if (this.apiKey) {
      this.client = new OpenAI({
        apiKey: this.apiKey
      });
    }
  }

  isConfigured() {
    return !!this.apiKey && !!this.client;
  }

  async ask(message, context, conversationHistory = []) {
    if (!this.isConfigured()) {
      throw new Error('OpenAI API key not configured. Add OPENAI_API_KEY to your .env file');
    }

    try {
      // Format the context into a system prompt
      const systemPrompt = this.formatContext(context);

      // Build messages array
      const messages = this.buildMessages(systemPrompt, message, conversationHistory);

      logger.system('Calling OpenAI API', {
        model: this.model,
        messageCount: messages.length,
        contextUsers: context.users?.length || 0,
        contextTweets: context.tweets?.length || 0
      });

      // Make the API call to OpenAI
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000,
        stream: false
      });

      // Extract the response
      const aiResponse = completion.choices?.[0]?.message?.content;

      if (!aiResponse) {
        throw new Error('Empty response from OpenAI API');
      }

      logger.system('OpenAI API response received', {
        responseLength: aiResponse.length,
        usage: completion.usage
      });

      return {
        response: aiResponse,
        model: this.model,
        provider: this.name,
        usage: completion.usage || null,
        context: {
          userCount: context.users?.length || 0,
          tweetCount: context.tweets?.length || 0,
          embeddingCount: context.embeddings?.length || 0
        }
      };

    } catch (error) {
      logger.error('OpenAI API error', {
        error: error.message,
        type: error.constructor.name,
        status: error.status
      });

      // Handle specific error cases
      if (error.status === 401) {
        throw new Error('Invalid OpenAI API key. Please check your OPENAI_API_KEY');
      } else if (error.status === 429) {
        throw new Error('OpenAI API rate limit exceeded. Please wait and try again');
      } else if (error.status === 400) {
        throw new Error(`OpenAI API request error: ${error.message}`);
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('OpenAI API request timed out. Please try again');
      }

      throw new Error(`OpenAI API error: ${error.message}`);
    }
  }
}