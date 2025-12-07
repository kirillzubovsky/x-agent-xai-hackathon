import axios from "axios";
import { config } from "../config.js";
import { logger } from "../../logger.js";
import { rateLimitManager } from "./rate-limiter.js";
import { requestInspector } from "../services/request-inspector.js";
import {
  Histogram,
  Counter,
  collectDefaultMetrics,
  register,
} from "prom-client";

// Prometheus metrics for X API calls (disabled in test env)
let requestDuration, requestTotal, requestErrors;
if (process.env.NODE_ENV !== "test") {
  collectDefaultMetrics({ timeout: 5000 });

  requestDuration = new Histogram({
    name: "xapi_request_duration_seconds",
    help: "Duration of X API requests in seconds",
    labelNames: ["method", "endpoint_type", "status_code"],
  });

  requestTotal = new Counter({
    name: "xapi_requests_total",
    help: "Total number of X API requests",
    labelNames: ["method", "endpoint_type", "status_code"],
  });

  requestErrors = new Counter({
    name: "xapi_request_errors_total",
    help: "Total X API request errors",
    labelNames: ["method", "endpoint_type", "error_type"],
  });
}

export { register as promRegister };

class XAPIClient {
  constructor() {
    this.baseURL = config.xcom.apiBaseUrl;
    this.bearerToken = config.xcom.bearerToken;
    this.isConfigured = !!this.bearerToken;

    if (this.isConfigured) {
      this.client = axios.create({
        baseURL: this.baseURL,
        headers: {
          Authorization: `Bearer ${this.bearerToken}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      });

      // Add response interceptor for rate limit headers
      this.client.interceptors.response.use(
        (response) => {
          this.handleRateLimitHeaders(response);
          return response;
        },
        (error) => {
          if (error.response) {
            this.handleRateLimitHeaders(error.response);
          }
          return Promise.reject(error);
        },
      );

      logger.system("X API Client initialized");
    } else {
      logger.system(
        "X API Client in demo mode - add X_COM_BEARER_TOKEN to .env",
      );
    }
  }

  isReady() {
    return this.isConfigured;
  }

  requireConfiguration() {
    if (!this.isConfigured) {
      throw new Error("X.com API not configured - missing bearer token");
    }
  }

  handleRateLimitHeaders(response) {
    const endpoint = this.getEndpointFromUrl(
      response.config?.url || response.config.url,
    );
    if (endpoint && response.headers) {
      rateLimitManager.updateLimits(endpoint, response.headers);
    }
  }

  /**
   * Private method for making API requests with retry, logging, and rate limit handling
   * @param {string} endpointType - 'users', 'tweets', etc for rate limiting
   * @param {string} method - HTTP method
   * @param {string} urlPath - Path relative to baseURL
   * @param {object} requestConfig - Axios config (params, data, etc)
   * @returns {Promise<object>} Response data
   */
  sanitizeHeaders(headers) {
    if (!headers) return {};
    const sanitized = { ...headers };
    if (sanitized.Authorization) {
      const parts = sanitized.Authorization.split(" ");
      if (parts.length === 2) {
        const keyPart = parts[1];
        const masked =
          keyPart.substring(0, 8) +
          "..." +
          keyPart.substring(keyPart.length - 4);
        sanitized.Authorization = `${parts[0]} ${masked}`;
      }
    }
    return sanitized;
  }

  async _makeRequest(endpointType, method, urlPath, requestConfig = {}) {
    this.requireConfiguration();
    await rateLimitManager.checkAndWait(endpointType);

    const startTime = Date.now();
    const fullUrl = this.baseURL + urlPath;
    const logParams = requestConfig.params
      ? { paramCount: Object.keys(requestConfig.params).length }
      : {};

    logger.api(`X API Request [${method.toUpperCase()}] Start`, {
      endpointType,
      url: fullUrl,
      ...logParams,
    });

    // Common request data for inspector
    const commonReq = {
      url: fullUrl,
      method: method.toUpperCase(),
      headers: this.sanitizeHeaders(requestConfig.headers || {}),
      body: requestConfig.data ? "[data present]" : undefined,
      params: requestConfig.params
        ? { count: Object.keys(requestConfig.params).length }
        : undefined,
    };

    let lastError;
    const maxRetries = 5;
    let delay = 0;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client({
          method,
          url: urlPath,
          ...requestConfig,
          timeout: 30000,
        });

        const duration = Date.now() - startTime;
        logger.api(`X API Request [${method.toUpperCase()}] Success`, {
          endpointType,
          duration,
          status: response.status,
          dataType: Array.isArray(response.data.data)
            ? `${response.data.data.length} items`
            : "object",
        });

        // Prometheus metrics
        if (requestDuration) {
          requestDuration.observe(duration / 1000, [
            method,
            endpointType,
            response.status.toString(),
          ]);
        }
        if (requestTotal) {
          requestTotal.inc({
            method,
            endpoint_type: endpointType,
            status_code: response.status.toString(),
          });
        }

        // Capture success for inspector
        requestInspector.capture({
          provider: "X",
          model: null,
          type: `${method.toUpperCase()}-${endpointType}`,
          request: commonReq,
          response: {
            status: response.status,
            statusText: response.statusText || "OK",
            headers: response.headers,
            data: Array.isArray(response.data.data)
              ? {
                  type: "array",
                  length: response.data.data.length,
                  sample: response.data.data.slice(0, 3).map((t) => ({
                    id: t.id,
                    textSnippet: t.text?.substring(0, 50) + "...",
                  })),
                }
              : response.data, // Full for small objects
          },
          duration,
          usage: null,
          context: { endpointType },
          userMessage: null,
        });

        // Interceptor already handles rate limits
        return response.data;
      } catch (error) {
        lastError = error;
        const duration = Date.now() - startTime;
        const status = error.response?.status || "network";

        logger.api(
          `X API Request [${method.toUpperCase()}] Attempt ${attempt}/${maxRetries} Failed`,
          {
            endpointType,
            duration,
            status,
            error: error.message,
          },
        );

        // Prometheus metrics for error
        if (requestErrors) {
          const errorType =
            status === 429
              ? "rate_limit"
              : status >= 500
                ? "server_error"
                : error.code || "unknown";
          requestErrors.inc({
            method,
            endpoint_type: endpointType,
            error_type: errorType,
          });
        }

        // Capture attempt/fail for inspector
        requestInspector.capture({
          provider: "X",
          model: null,
          type: `${method.toUpperCase()}-${endpointType}`,
          request: commonReq,
          response: {
            status,
            error: error.message,
            data: error.response?.data,
            headers: error.response?.headers,
          },
          duration,
          usage: null,
          context: { endpointType, attempt },
          userMessage: null,
        });

        if (attempt === maxRetries) {
          // Final total metric for failed request
          if (requestTotal) {
            requestTotal.inc({
              method,
              endpointType,
              status_code: status.toString() || "error",
            });
          }
          throw lastError;
        }

        // Determine delay
        delay = 1000 * Math.pow(2, attempt - 1); // Exponential backoff: 1s, 2s, 4s, 8s, 16s

        if (status === 429) {
          // Respect rate limit reset
          const resetHeader = error.response?.headers["x-rate-limit-reset"];
          if (resetHeader) {
            const resetTime = parseInt(resetHeader) * 1000;
            delay = Math.max(delay, resetTime - Date.now());
          }
        } else if (
          status >= 500 ||
          error.code === "ECONNABORTED" ||
          !error.response
        ) {
          // Retry on server errors, timeouts, network issues
          // No retry on 4xx client errors
        } else {
          // Non-retryable client error
          throw error;
        }

        logger.api(`X API Retry Delay`, {
          endpointType,
          attempt,
          delay: Math.ceil(delay / 1000) + "s",
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  getEndpointFromUrl(url) {
    if (url.includes("/tweets")) return "tweets";
    if (url.includes("/users")) return "users";
    if (url.includes("/search")) return "search";
    return null;
  }

  async getUserByUsername(username) {
    try {
      return await this._makeRequest(
        "users",
        "get",
        `/users/by/username/${username}`,
        {
          params: {
            "user.fields": [
              "id",
              "name",
              "username",
              "description",
              "location",
              "profile_image_url",
              "verified",
              "verified_type",
              "public_metrics",
              "created_at",
            ].join(","),
          },
        },
      );
    } catch (error) {
      logger.error("Failed to get user after retries", {
        username,
        error: error.message,
        status: error.response?.status,
      });
      throw error;
    }
  }

  async getUserTweets(userId, options = {}) {
    const {
      maxResults = 3000,
      paginationToken = null,
      excludeReplies = false, // Include all by default
      excludeRetweets = true,
    } = options;

    try {
      const params = {
        max_results: Math.min(maxResults, 10000),
        "tweet.fields": [
          "id",
          "text",
          "created_at",
          "public_metrics",
          "context_annotations",
          "conversation_id",
          "in_reply_to_user_id",
          "referenced_tweets",
          "lang",
          "source",
        ].join(","),
        "user.fields": "id,name,username",
        expansions: "author_id",
      };

      if (paginationToken) params.pagination_token = paginationToken;

      //Control what to exclude
      const excludes = [];
      if (excludeReplies) excludes.push("replies");
      if (excludeRetweets) excludes.push("retweets");
      if (excludes.length > 0) params.exclude = excludes.join(",");

      const responseData = await this._makeRequest(
        "tweets",
        "get",
        `/users/${userId}/tweets`,
        { params },
      );

      return {
        data: responseData.data || [],
        includes: responseData.includes || {},
        meta: responseData.meta || {},
        nextToken: responseData.meta?.next_token,
      };
    } catch (error) {
      logger.error("Failed to get tweets after retries", {
        userId,
        error: error.message,
        status: error.response?.status,
      });
      throw error;
    }
  }

  async testConnection() {
    if (!this.isConfigured) {
      return {
        success: false,
        configured: false,
        error: "X.com API not configured",
        message: "Add X_COM_BEARER_TOKEN to .env file",
      };
    }

    try {
      // Simple test with minimal rate limit impact
      const rateLimits = await rateLimitManager.getStatus();

      return {
        success: true,
        configured: true,
        rateLimits,
        message: "X.com API ready",
      };
    } catch (error) {
      logger.error("API test failed", { error: error.message });
      return {
        success: false,
        configured: true,
        error: error.message,
      };
    }
  }

  /**
   * Search for recent tweets from the last 7 days
   * @param {string} query - Search query (1-4096 chars, supports operators like OR, AND, NOT)
   * @param {object} options - Search options
   * @param {number} options.maxResults - Max results per request (10-100, default 100)
   * @param {string} options.paginationToken - Token for next page
   * @param {string} options.startTime - ISO 8601 timestamp for oldest results (inclusive)
   * @param {string} options.endTime - ISO 8601 timestamp for newest results (exclusive)
   * @param {string} options.sinceId - Return results newer than this tweet ID
   * @param {string} options.untilId - Return results older than this tweet ID
   * @param {string} options.sortOrder - 'recency' or 'relevancy' (default: relevancy)
   * @param {array} options.tweetFields - Tweet fields to include
   * @returns {Promise<object>} Search results with data, includes, meta, nextToken
   */
  async searchTweets(query, options = {}) {
    const {
      maxResults = 100,
      paginationToken = null,
      startTime = null,
      endTime = null,
      sinceId = null,
      untilId = null,
      sortOrder = null,
      tweetFields = [
        "id",
        "text",
        "author_id",
        "created_at",
        "public_metrics",
        "context_annotations",
      ],
    } = options;

    try {
      const params = {
        query,
        max_results: Math.min(maxResults, 100), // API limit: 10-100
        "tweet.fields": Array.isArray(tweetFields) ? tweetFields.join(",") : tweetFields,
        "user.fields": "id,username,name,verified,public_metrics",
        expansions: "author_id",
      };

      // Time filters (ISO 8601 format: YYYY-MM-DDTHH:mm:ssZ)
      if (startTime) params.start_time = startTime;
      if (endTime) params.end_time = endTime;

      // ID-based filters
      if (sinceId) params.since_id = sinceId;
      if (untilId) params.until_id = untilId;

      // Sort order
      if (sortOrder) params.sort_order = sortOrder;

      // Pagination
      if (paginationToken) params.next_token = paginationToken;

      const responseData = await this._makeRequest(
        "search",
        "get",
        `/tweets/search/recent`,
        { params },
      );

      return {
        data: responseData.data || [],
        includes: responseData.includes || {},
        meta: responseData.meta || {},
        nextToken: responseData.meta?.next_token,
      };
    } catch (error) {
      logger.error("Failed to search tweets after retries", {
        query: query.substring(0, 50) + "...",
        error: error.message,
        status: error.response?.status,
      });
      throw error;
    }
  }

  /**
   * Get paginated followers for a user (Enterprise access for high volume)
   * @param {string} userId - X user ID
   * @param {object} options - { maxResults=1000, paginationToken }
   * @returns {Promise<object>} { data: [users], meta, nextToken }
   */
  async getUserFollowers(userId, options = {}) {
    const { maxResults = 1000, paginationToken = null } = options;

    try {
      const params = {
        max_results: Math.min(maxResults, 1000), // API limit
        "user.fields": "id,username,name,public_metrics,description,verified",
        expansions: "pinned_tweet_id",
      };

      if (paginationToken) params.pagination_token = paginationToken;

      const responseData = await this._makeRequest(
        "followers",
        "get",
        `/users/${userId}/followers`,
        { params },
      );

      return {
        data: responseData.data || [], // Array of follower user objects
        includes: responseData.includes || {},
        meta: responseData.meta || {},
        nextToken: responseData.meta?.next_token,
      };
    } catch (error) {
      logger.error("Failed to get followers after retries", {
        userId,
        error: error.message,
        status: error.response?.status,
      });
      throw error;
    }
  }

  /**
   * Get paginated users the target follows (following graph)
   * @param {string} userId - X user ID
   * @param {object} options - { maxResults=1000, paginationToken }
   * @returns {Promise<object>} { data: [users], meta, nextToken }
   */
  async getUserFollowing(userId, options = {}) {
    const { maxResults = 1000, paginationToken = null } = options;

    try {
      const params = {
        max_results: Math.min(maxResults, 1000), // API limit
        "user.fields": "id,username,name,public_metrics,description,verified",
        expansions: "pinned_tweet_id",
      };

      if (paginationToken) params.pagination_token = paginationToken;

      const responseData = await this._makeRequest(
        "following",
        "get",
        `/users/${userId}/following`,
        { params },
      );

      return {
        data: responseData.data || [], // Array of followed user objects
        includes: responseData.includes || {},
        meta: responseData.meta || {},
        nextToken: responseData.meta?.next_token,
      };
    } catch (error) {
      logger.error("Failed to get following after retries", {
        userId,
        error: error.message,
        status: error.response?.status,
      });
      throw error;
    }
  }

  /**
   * Get full followers list by paginating until complete (use sparingly for large graphs)
   * @param {string} userId - X user ID
   * @param {object} options - { maxUsers=Infinity, userFields }
   * @returns {Promise<array>} Full array of follower users
   * @note Rate limits apply; Enterprise high quotas ok for deep graphs
   */
  async getFullUserFollowers(userId, options = {}) {
    const { maxUsers = Infinity, userFields } = options;

    logger.api("Starting getFullUserFollowers", { userId, maxUsers });

    let allFollowers = [];
    let token = null;
    let count = 0;

    while (count < maxUsers) {
      try {
        logger.api("Fetching followers page", { userId, count, token: token ? 'has token' : 'no token' });

        const res = await this.getUserFollowers(userId, {
          maxResults: Math.min(1000, maxUsers - count),
          paginationToken: token,
          ...(userFields && { "user.fields": userFields }),
        });

        logger.api("Followers page received", {
          userId,
          dataLength: res.data?.length || 0,
          hasNextToken: !!res.nextToken
        });

        if (!res.data || res.data.length === 0) {
          logger.api("No followers data, breaking", { userId });
          break;
        }

        allFollowers.push(...res.data);
        count += res.data.length;

        if (!res.nextToken) break;

        token = res.nextToken;

        // Optional delay for very large graphs to respect rates
        if (count % 5000 === 0) {
          logger.api("Full followers pagination checkpoint", {
            userId,
            count,
            totalFetched: allFollowers.length,
          });
          await new Promise((r) => setTimeout(r, 100)); // Minimal
        }
      } catch (error) {
        logger.error("Full followers pagination error", {
          userId,
          error: error.message,
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          stack: error.stack
        });
        break; // Stop on fail
      }
    }

    logger.api("Full followers collection complete", {
      userId,
      total: allFollowers.length,
    });
    return allFollowers;
  }

  /**
   * Similar for full following graph
   */
  async getFullUserFollowing(userId, options = {}) {
    const { maxUsers = Infinity, userFields } = options;

    let allFollowing = [];
    let token = null;
    let count = 0;

    while (count < maxUsers) {
      try {
        const res = await this.getUserFollowing(userId, {
          maxResults: Math.min(1000, maxUsers - count),
          paginationToken: token,
          ...(userFields && { "user.fields": userFields }),
        });

        if (!res.data || res.data.length === 0) break;

        allFollowing.push(...res.data);
        count += res.data.length;

        if (!res.nextToken) break;

        token = res.nextToken;

        if (count % 5000 === 0) {
          logger.api("Full following pagination checkpoint", {
            userId,
            count,
            totalFetched: allFollowing.length,
          });
          await new Promise((r) => setTimeout(r, 100));
        }
      } catch (error) {
        logger.error("Full following pagination error", {
          userId,
          error: error.message,
        });
        break;
      }
    }

    logger.api("Full following collection complete", {
      userId,
      total: allFollowing.length,
    });
    return allFollowing;
  }

  /**
   * Get paginated list of users blocked by the authenticated user
   * @param {string} userId - X user ID
   * @param {object} options - { maxResults=1000, paginationToken }
   * @returns {Promise<object>} { data: [users], meta, nextToken }
   */
  async getUserBlocking(userId, options = {}) {
    const { maxResults = 1000, paginationToken = null } = options;

    try {
      const params = {
        max_results: Math.min(maxResults, 1000), // API limit
        "user.fields": "id,username,name,public_metrics,description,verified",
        expansions: "pinned_tweet_id",
      };

      if (paginationToken) params.pagination_token = paginationToken;

      const responseData = await this._makeRequest(
        "blocking",
        "get",
        `/users/${userId}/blocking`,
        { params },
      );

      return {
        data: responseData.data || [], // Array of blocked user objects
        includes: responseData.includes || {},
        meta: responseData.meta || {},
        nextToken: responseData.meta?.next_token,
      };
    } catch (error) {
      logger.error("Failed to get blocking list after retries", {
        userId,
        error: error.message,
        status: error.response?.status,
      });
      throw error;
    }
  }

  /**
   * Get full blocking list by paginating until complete
   * @param {string} userId - X user ID
   * @param {object} options - { maxUsers=Infinity, userFields }
   * @returns {Promise<array>} Full array of blocked users
   */
  async getFullUserBlocking(userId, options = {}) {
    const { maxUsers = Infinity, userFields } = options;

    let allBlocked = [];
    let token = null;
    let count = 0;

    while (count < maxUsers) {
      try {
        const res = await this.getUserBlocking(userId, {
          maxResults: Math.min(1000, maxUsers - count),
          paginationToken: token,
          ...(userFields && { "user.fields": userFields }),
        });

        if (!res.data || res.data.length === 0) break;

        allBlocked.push(...res.data);
        count += res.data.length;

        if (!res.nextToken) break;

        token = res.nextToken;

        // Optional delay for very large lists
        if (count % 5000 === 0) {
          logger.api("Full blocking pagination checkpoint", {
            userId,
            count,
            totalFetched: allBlocked.length,
          });
          await new Promise((r) => setTimeout(r, 100));
        }
      } catch (error) {
        logger.error("Full blocking pagination error", {
          userId,
          error: error.message,
        });
        break; // Stop on fail
      }
    }

    logger.api("Full blocking collection complete", {
      userId,
      total: allBlocked.length,
    });
    return allBlocked;
  }

  async getRateLimitStatus() {
    return await rateLimitManager.getStatus();
  }
}

export const xAPI = new XAPIClient();
