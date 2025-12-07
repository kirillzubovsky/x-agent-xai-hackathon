import { GrokProvider } from './grok-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { OllamaProvider } from './ollama-provider.js';
import { logger } from '../../../logger.js';

/**
 * Factory for creating AI providers based on configuration
 */
export class AIProviderFactory {
  static providers = {
    grok: GrokProvider,
    openai: OpenAIProvider,
    ollama: OllamaProvider
  };

  /**
   * Get the configured AI provider based on environment settings
   * Priority order: AI_PROVIDER env var > Grok > OpenAI > Ollama
   */
  static getProvider(config) {
    // Check if specific provider is configured via env var
    const preferredProvider = process.env.AI_PROVIDER?.toLowerCase();

    if (preferredProvider && this.providers[preferredProvider]) {
      logger.system('Using preferred AI provider from AI_PROVIDER env var', {
        provider: preferredProvider
      });
      return new this.providers[preferredProvider](config);
    }

    // Check providers in priority order
    // 1. Try Grok first (since you have X.AI key)
    if (config.ai?.xai?.apiKey) {
      logger.system('Using Grok provider (XAI_API_KEY found)');
      return new GrokProvider(config);
    }

    // 2. Try OpenAI
    if (config.ai?.openai?.apiKey) {
      logger.system('Using OpenAI provider (OPENAI_API_KEY found)');
      return new OpenAIProvider(config);
    }

    // 3. Default to Ollama (local, no API key needed)
    logger.system('Using Ollama provider (default local model)');
    return new OllamaProvider(config);
  }

  /**
   * Get information about all available providers
   */
  static getAvailableProviders(config) {
    const available = [];

    // Check each provider
    const grok = new GrokProvider(config);
    if (grok.isConfigured()) {
      available.push(grok.getInfo());
    }

    const openai = new OpenAIProvider(config);
    if (openai.isConfigured()) {
      available.push(openai.getInfo());
    }

    // Ollama is always "available" but might not be running
    const ollama = new OllamaProvider(config);
    available.push(ollama.getInfo());

    return available;
  }

  /**
   * Get a specific provider by name
   */
  static getProviderByName(name, config) {
    const providerName = name.toLowerCase();

    if (!this.providers[providerName]) {
      throw new Error(`Unknown AI provider: ${name}. Available: ${Object.keys(this.providers).join(', ')}`);
    }

    const ProviderClass = this.providers[providerName];
    const provider = new ProviderClass(config);

    if (!provider.isConfigured()) {
      throw new Error(`Provider ${name} is not properly configured. Check your environment variables.`);
    }

    return provider;
  }
}