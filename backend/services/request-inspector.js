import { logger } from '../../logger.js';

/**
 * Request Inspector Service
 * Captures and stores raw request/response data for debugging
 */
class RequestInspector {
  constructor() {
    this.inspectionData = [];
    this.maxEntries = 100; // Keep last 100 requests
  }

  /**
   * Capture an API request/response
   */
  capture(data) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      provider: data.provider,
      model: data.model,
      type: data.type || 'chat',
      request: {
        url: data.request?.url,
        method: data.request?.method || 'POST',
        headers: this.sanitizeHeaders(data.request?.headers),
        body: data.request?.body,
        params: data.request?.params
      },
      response: {
        status: data.response?.status,
        statusText: data.response?.statusText,
        headers: data.response?.headers,
        data: data.response?.data,
        error: data.response?.error
      },
      metadata: {
        duration: data.duration,
        usage: data.usage,
        context: data.context,
        userMessage: data.userMessage,
        conversationId: data.conversationId
      }
    };

    this.inspectionData.push(entry);

    // Keep only the last maxEntries
    if (this.inspectionData.length > this.maxEntries) {
      this.inspectionData.shift();
    }

    logger.system('Request captured for inspection', {
      id: entry.id,
      provider: entry.provider,
      model: entry.model,
      duration: entry.metadata?.duration || 'N/A',
      status: entry.response?.status || 'pending'
    });

    return entry.id;
  }

  /**
   * Sanitize headers to remove sensitive data
   */
  sanitizeHeaders(headers) {
    if (!headers) return {};

    const sanitized = { ...headers };

    // Show that auth exists but mask the actual key
    if (sanitized.Authorization) {
      const parts = sanitized.Authorization.split(' ');
      if (parts.length === 2) {
        const keyPart = parts[1];
        const masked = keyPart.substring(0, 8) + '...' + keyPart.substring(keyPart.length - 4);
        sanitized.Authorization = `${parts[0]} ${masked}`;
      }
    }

    return sanitized;
  }

  /**
   * Get all inspection data
   */
  getAll() {
    return this.inspectionData;
  }

  /**
   * Get inspection data by ID
   */
  getById(id) {
    return this.inspectionData.find(entry => entry.id === id);
  }

  /**
   * Get latest N entries
   */
  getLatest(count = 10) {
    return this.inspectionData.slice(-count).reverse();
  }

  /**
   * Get entries by provider
   */
  getByProvider(provider) {
    return this.inspectionData.filter(entry =>
      entry.provider?.toLowerCase() === provider.toLowerCase()
    );
  }

  /**
   * Clear all inspection data
   */
  clear() {
    this.inspectionData = [];
    logger.system('Inspection data cleared');
  }

  /**
   * Get statistics about captured requests
   */
  getStats() {
    const stats = {
      total: this.inspectionData.length,
      providers: {},
      models: {},
      errors: 0,
      avgDuration: 0
    };

    let totalDuration = 0;
    let durationCount = 0;

    this.inspectionData.forEach(entry => {
      // Count by provider
      if (entry.provider) {
        stats.providers[entry.provider] = (stats.providers[entry.provider] || 0) + 1;
      }

      // Count by model
      if (entry.model) {
        stats.models[entry.model] = (stats.models[entry.model] || 0) + 1;
      }

      // Count errors
      if (entry.response?.error) {
        stats.errors++;
      }

      // Calculate average duration
      if (entry.metadata?.duration) {
        totalDuration += entry.metadata.duration;
        durationCount++;
      }
    });

    if (durationCount > 0) {
      stats.avgDuration = Math.round(totalDuration / durationCount);
    }

    return stats;
  }
}

// Create singleton instance
export const requestInspector = new RequestInspector();