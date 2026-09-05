import { BaseAIProvider } from './base-provider.js';
import { logger } from '../../../logger.js';
import { requestInspector } from '../request-inspector.js';
import axios from 'axios';

/**
 * Grok (X.AI) Provider Implementation
 */
export class GrokProvider extends BaseAIProvider {
  constructor(config) {
    super(config);
    this.name = 'Grok';
    this.model = config.ai?.xai?.model || 'grok-4.20-0309-reasoning';
    this.apiKey = config.ai?.xai?.apiKey;
    this.baseUrl = config.ai?.xai?.baseUrl || 'https://api.x.ai/v1';
    this.maxContextTokens = 8192; // Grok supports larger context
    this.supportsImageGen = true;
    this.supportsImageEdit = true;
  }

  isConfigured() {
    return !!this.apiKey;
  }

  async ask(message, context, conversationHistory = []) {
    if (!this.isConfigured()) {
      throw new Error('Grok API key not configured. Add XAI_API_KEY to your .env file');
    }

    try {
      // Format the context into a system prompt
      const systemPrompt = this.formatContext(context);

      // Build messages array
      const messages = this.buildMessages(systemPrompt, message, conversationHistory);

      logger.system('Calling Grok API', {
        model: this.model,
        messageCount: messages.length,
        contextUsers: context.users?.length || 0,
        contextTweets: context.tweets?.length || 0
      });

      // Prepare request data for inspection
      const requestUrl = `${this.baseUrl}/chat/completions`;
      const requestBody = {
        model: this.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 12000,
        stream: false
      };
      const requestHeaders = {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      };

      const startTime = Date.now();

      // Make the API call to Grok
      const response = await axios.post(
        requestUrl,
        requestBody,
        {
          headers: requestHeaders,
          timeout: 60000 // 30 second timeout
        }
      );

      const duration = Date.now() - startTime;

      // Extract the response
      const aiResponse = response.data.choices?.[0]?.message?.content;

      // Capture the request/response for inspection
      requestInspector.capture({
        provider: this.name,
        model: this.model,
        type: 'chat',
        request: {
          url: requestUrl,
          method: 'POST',
          headers: requestHeaders,
          body: requestBody
        },
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          data: response.data
        },
        duration,
        usage: response.data.usage,
        context: {
          userCount: context.users?.length || 0,
          tweetCount: context.tweets?.length || 0,
          embeddingCount: context.embeddings?.length || 0
        },
        userMessage: message
      });

      if (!aiResponse) {
        throw new Error('Empty response from Grok API');
      }

      logger.system('Grok API response received', {
        responseLength: aiResponse.length,
        usage: response.data.usage
      });

      return {
        response: aiResponse,
        model: this.model,
        provider: this.name,
        usage: response.data.usage || null,
        context: {
          userCount: context.users?.length || 0,
          tweetCount: context.tweets?.length || 0,
          embeddingCount: context.embeddings?.length || 0
        }
      };

    } catch (error) {
      logger.error('Grok API error', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status
      });

      // Capture error for inspection
      requestInspector.capture({
        provider: this.name,
        model: this.model,
        type: 'chat',
        request: {
          url: `${this.baseUrl}/chat/completions`,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: {
            model: this.model,
            messages: messages,
            temperature: 0.7,
            max_tokens: 12000,
            stream: false
          }
        },
        response: {
          status: error.response?.status,
          statusText: error.response?.statusText,
          error: error.message,
          data: error.response?.data
        },
        userMessage: message,
        context: {
          userCount: context.users?.length || 0,
          tweetCount: context.tweets?.length || 0,
          embeddingCount: context.embeddings?.length || 0
        }
      });

      // Handle specific error cases
      if (error.response?.status === 401) {
        throw new Error('Invalid Grok API key. Please check your XAI_API_KEY');
      } else if (error.response?.status === 429) {
        throw new Error('Grok API rate limit exceeded. Please wait and try again');
      } else if (error.response?.status === 400) {
        throw new Error(`Grok API request error: ${error.response?.data?.error?.message || 'Invalid request'}`);
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Grok API request timed out. Please try again');
      }

      throw new Error(`Grok API error: ${error.message}`);
    }
  }

  async generateImage(prompt, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('Grok API key not configured. Add XAI_API_KEY to your .env file');
    }

    const {
      model = 'grok-imagine-v0p9',
      n = 1,
      quality = 'medium',
      response_format = 'url'
    } = options;

    try {
      const requestUrl = `${this.baseUrl}/images/generations`;
      const requestBody = {
        prompt,
        model,
        n,
        quality,
        response_format
      };
      const requestHeaders = {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      };

      const startTime = Date.now();

      const response = await axios.post(
        requestUrl,
        requestBody,
        {
          headers: requestHeaders,
          timeout: 60000
        }
      );

      const duration = Date.now() - startTime;
      const data = response.data.data || [];

      // Capture the request/response for inspection
      requestInspector.capture({
        provider: this.name,
        model,
        type: 'image_generation',
        request: {
          url: requestUrl,
          method: 'POST',
          headers: requestHeaders,
          body: requestBody
        },
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          data: response.data
        },
        duration,
        prompt
      });

      logger.system('Grok image generation response received', {
        imageCount: data.length,
        model,
        duration
      });

      if (data.length === 0) {
        throw new Error('No images generated by Grok API');
      }

      return {
        images: data.map(img => ({
          url: img.url,
          b64_json: img.b64_json || null,
          revised_prompt: img.revised_prompt || null
        })),
        model,
        provider: this.name
      };

    } catch (error) {
      logger.error('Grok image generation error', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status
      });

      // Capture error for inspection
      requestInspector.capture({
        provider: this.name,
        model: options.model || 'grok-imagine-v0p9',
        type: 'image_generation',
        request: {
          url: `${this.baseUrl}/images/generations`,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey ? '[REDACTED]' : 'missing'}`,
            'Content-Type': 'application/json'
          },
          body: {
            prompt: prompt.substring(0, 500) + (prompt.length > 500 ? '...' : ''),
            model: options.model || 'grok-imagine-v0p9',
            n: options.n || 1,
            quality: options.quality || 'medium',
            response_format: options.response_format || 'url'
          }
        },
        response: {
          status: error.response?.status,
          statusText: error.response?.statusText,
          error: error.message,
          data: error.response?.data
        },
        prompt: prompt.substring(0, 200) + (prompt.length > 200 ? '...' : '')
      });

      if (error.response?.status === 401) {
        throw new Error('Invalid Grok API key. Please check your XAI_API_KEY');
      } else if (error.response?.status === 429) {
        throw new Error('Grok API rate limit exceeded. Please wait and try again');
      } else if (error.response?.status === 400) {
        throw new Error(`Grok image gen request error: ${error.response?.data?.error?.message || 'Invalid request'}`);
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Grok API request timed out. Please try again');
      }

      throw new Error(`Grok image generation error: ${error.message}`);
    }
  }

  async editImage(imageInput, prompt, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('Grok API key not configured. Add XAI_API_KEY to your .env file');
    }

    if (!imageInput || typeof imageInput !== 'string') {
      throw new Error('imageInput must be a valid URL string or base64 data URI');
    }

    if (!prompt) {
      throw new Error('Prompt required for image editing');
    }

    const {
      model = 'grok-imagine-v0p9',
      n = 1,
      response_format = 'url'
    } = options;

    try {
      const requestUrl = `${this.baseUrl}/images/edits`;
      const requestBody = {
        prompt,
        image: {
          url: imageInput
        },
        model,
        n,
        response_format
      };
      const requestHeaders = {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      };

      const startTime = Date.now();

      const response = await axios.post(
        requestUrl,
        requestBody,
        {
          headers: requestHeaders,
          timeout: 90000  // Longer timeout for image processing
        }
      );

      const duration = Date.now() - startTime;
      const data = response.data.data || [];

      // Capture for inspection
      requestInspector.capture({
        provider: this.name,
        model,
        type: 'image_edit',
        request: {
          url: requestUrl,
          method: 'POST',
          headers: requestHeaders,
          body: requestBody
        },
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          data: response.data
        },
        duration,
        prompt,
        imageInput: imageInput.startsWith('data:') ? '[BASE64_DATA]' : imageInput
      });

      logger.system('Grok image edit response received', {
        imageCount: data.length,
        model,
        duration
      });

      if (data.length === 0) {
        throw new Error('No edited images returned by Grok API');
      }

      return {
        images: data.map(img => ({
          url: img.url,
          b64_json: img.b64_json || null,
          revised_prompt: img.revised_prompt || null
        })),
        model,
        provider: this.name
      };

    } catch (error) {
      logger.error('Grok image edit error', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status
      });

      requestInspector.capture({
        provider: this.name,
        model: options.model || 'grok-imagine-v0p9',
        type: 'image_edit',
        request: {
          url: `${this.baseUrl}/images/edits`,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey ? '[REDACTED]' : 'missing'}`,
            'Content-Type': 'application/json'
          },
          body: {
            prompt: prompt.substring(0, 500) + (prompt.length > 500 ? '...' : ''),
            image: { url: imageInput.startsWith('data:') ? '[BASE64_DATA]' : imageInput },
            model: options.model || 'grok-imagine-v0p9',
            n: options.n || 1,
            response_format: options.response_format || 'url'
          }
        },
        response: {
          status: error.response?.status,
          statusText: error.response?.statusText,
          error: error.message,
          data: error.response?.data
        },
        prompt: prompt.substring(0, 200) + (prompt.length > 200 ? '...' : '')
      });

      if (error.response?.status === 401) {
        throw new Error('Invalid Grok API key. Please check your XAI_API_KEY');
      } else if (error.response?.status === 429) {
        throw new Error('Grok API rate limit exceeded. Please wait and try again');
      } else if (error.response?.status === 400) {
        throw new Error(`Grok image edit request error: ${error.response?.data?.error?.message || 'Invalid request'}`);
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('Grok API request timed out. Please try again');
      }

      throw new Error(`Grok image editing error: ${error.message}`);
    }
  }
}
