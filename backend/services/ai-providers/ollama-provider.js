import { BaseAIProvider } from './base-provider.js';
import { logger } from '../../../logger.js';
import axios from 'axios';

/**
 * Ollama Provider Implementation for local models
 */
export class OllamaProvider extends BaseAIProvider {
  constructor(config) {
    super(config);
    this.name = 'Ollama';
    this.model = config.ai?.ollama?.model || process.env.OLLAMA_MODEL || 'llama2';
    this.baseUrl = config.ai?.ollama?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.maxContextTokens = 4096; // Depends on the model
  }

  isConfigured() {
    // Ollama doesn't need an API key, just check if we can reach it
    return true; // Will check connectivity when making requests
  }

  async checkConnection() {
    try {
      const response = await axios.get(`${this.baseUrl}/api/tags`, {
        timeout: 2000
      });
      return response.data?.models?.length > 0;
    } catch (error) {
      logger.error('Ollama connection check failed', {
        error: error.message,
        baseUrl: this.baseUrl
      });
      return false;
    }
  }

  async ask(message, context, conversationHistory = []) {
    try {
      // Check if Ollama is running
      const isConnected = await this.checkConnection();
      if (!isConnected) {
        throw new Error('Cannot connect to Ollama. Make sure Ollama is running locally');
      }

      // Format the context into a system prompt
      const systemPrompt = this.formatContext(context);

      // Build messages for Ollama (it uses a different format)
      const messages = this.buildMessages(systemPrompt, message, conversationHistory);

      logger.system('Calling Ollama API', {
        model: this.model,
        baseUrl: this.baseUrl,
        messageCount: messages.length,
        contextUsers: context.users?.length || 0,
        contextTweets: context.tweets?.length || 0
      });

      // Make the API call to Ollama
      const response = await axios.post(
        `${this.baseUrl}/api/chat`,
        {
          model: this.model,
          messages: messages,
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 1000 // max tokens equivalent
          }
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 60000 // 60 second timeout for local models
        }
      );

      // Extract the response
      const aiResponse = response.data?.message?.content;

      if (!aiResponse) {
        throw new Error('Empty response from Ollama');
      }

      logger.system('Ollama response received', {
        responseLength: aiResponse.length,
        model: this.model,
        totalDuration: response.data?.total_duration
      });

      return {
        response: aiResponse,
        model: this.model,
        provider: this.name,
        usage: {
          prompt_tokens: response.data?.prompt_eval_count || null,
          completion_tokens: response.data?.eval_count || null,
          total_tokens: (response.data?.prompt_eval_count || 0) + (response.data?.eval_count || 0)
        },
        context: {
          userCount: context.users?.length || 0,
          tweetCount: context.tweets?.length || 0,
          embeddingCount: context.embeddings?.length || 0
        }
      };

    } catch (error) {
      logger.error('Ollama API error', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status
      });

      // Handle specific error cases
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Cannot connect to Ollama. Please ensure Ollama is running on your machine (ollama serve)');
      } else if (error.response?.status === 404) {
        throw new Error(`Model ${this.model} not found. Please pull the model first: ollama pull ${this.model}`);
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Ollama request timed out. The model might be loading or processing slowly');
      }

      throw new Error(`Ollama error: ${error.message}`);
    }
  }
}