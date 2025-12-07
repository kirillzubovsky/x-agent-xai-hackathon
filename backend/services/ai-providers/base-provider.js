import { logger } from "../../../logger.js";

/**
 * Base class for AI Assistant providers
 * All providers must implement the ask() method
 */
export class BaseAIProvider {
  constructor(config) {
    this.config = config;
    this.name = "BaseProvider";
    this.model = null;
    this.maxContextTokens = 4096;
    this.supportsImageGen = false;
    this.supportsImageEdit = false;
  }

  /**
   * Format the context (tweets, users, embeddings) into a system prompt
   */
  formatContext(context) {
    const { users, tweets, similarityTweets, embeddings } = context;

    let systemPrompt =
      "You are an AI assistant analyzing Twitter/X user data and tweets.\n\n";

    // Add user context
    if (users && users.length > 0) {
      systemPrompt += "## Users Being Analyzed:\n";
      users.forEach((user) => {
        systemPrompt += `- @${user.username} : ${user.followersCount} followers, ${user.description || "No bio"}\n`;
      });
      systemPrompt += "\n";
    }

    // Add raw tweets (recent tweets, not filtered)
    if (tweets && tweets.length > 0) {
      systemPrompt += `## Recent Tweets - Raw Data (${tweets.length} total available):\n`;
      systemPrompt += "These are the most recent tweets in chronological order (raw, unfiltered data):\n";
      const tweetSample = tweets.slice(0, 20);
      tweetSample.forEach((tweet) => {
        const user = users.find((u) => u.id === tweet.userId);
        const username = user ? user.username : "unknown";
        systemPrompt += `@${username}: ${tweet.content.substring(0, 200)}${tweet.content.length > 200 ? "..." : ""}\n`;
      });
      systemPrompt += "\n";
    }

    // Add similarity-picked tweets (hand-picked based on embeddings)
    if (similarityTweets && similarityTweets.length > 0) {
      systemPrompt += `## Hand-Picked Tweets - Top by Embedding Similarity (${similarityTweets.length} total):\n`;
      systemPrompt += "These tweets were hand-picked based on embedding similarity to each user's overall content style and themes. They represent the most representative examples of each user's typical content:\n";
      similarityTweets.forEach((tweet) => {
        const user = users.find((u) => u.id === tweet.userId);
        const username = user ? user.username : "unknown";
        systemPrompt += `@${username}: ${tweet.content.substring(0, 200)}${tweet.content.length > 200 ? "..." : ""}\n`;
      });
      systemPrompt += "\n";
    }

    // Add embedding summary if available
    if (embeddings && embeddings.length > 0) {
      systemPrompt += `## Semantic Analysis Available:\n`;
      systemPrompt += `- ${embeddings.length} user embedding(s) available for semantic similarity analysis\n`;
      systemPrompt += `- These embeddings capture the overall writing style and topics of each user\n\n`;
    }

    systemPrompt +=
      "Based on this context, please answer the user's questions with insights about the Twitter users, their content, patterns, and relationships.";

    return systemPrompt;
  }

  /**
   * Build messages array for chat completion
   */
  buildMessages(systemPrompt, userMessage, conversationHistory = []) {
    const messages = [{ role: "system", content: systemPrompt }];

    // Add conversation history if available
    conversationHistory.forEach((msg) => {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    });

    // Add current user message
    messages.push({
      role: "user",
      content: userMessage,
    });

    return messages;
  }

  /**
   * Main method to get response from AI
   * Must be implemented by subclasses
   */
  async ask(message, context, conversationHistory = []) {
    throw new Error(`${this.name} must implement ask() method`);
  }

  /**
   * Generate an image from a text prompt
   * Subclasses should override if they support image generation
   */
  async generateImage(prompt, options = {}) {
    throw new Error(`${this.name} does not support image generation`);
  }

  /**
   * Edit an existing image based on a text prompt
   * Subclasses should override if they support image editing
   */
  async editImage(imageInput, prompt, options = {}) {
    throw new Error(`${this.name} does not support image editing`);
  }

  /**
   * Check if the provider is properly configured
   */
  isConfigured() {
    throw new Error(`${this.name} must implement isConfigured() method`);
  }

  /**
   * Get provider information
   */
  getInfo() {
    return {
      name: this.name,
      model: this.model,
      configured: this.isConfigured(),
      maxContextTokens: this.maxContextTokens,
      supportsImageGen: this.supportsImageGen,
      supportsImageEdit: this.supportsImageEdit,
    };
  }
}
