import { PrismaClient } from "@prisma/client";
import { logger } from "../../logger.js";
import { collectionService } from "./collection-service.js";
import embeddingService from "./embedding-service.js";
import { AIProviderFactory } from "./ai-providers/index.js";
import { config } from "../config.js";
import axios from "axios";

const prisma = new PrismaClient();

/**
 * User Onboarding Service
 * Automates the complete user setup process:
 * 1. Collect tweets
 * 2. Generate embeddings
 * 3. Generate dossier
 * 4. Generate search suggestions
 * 5. Generate LIVE timeline
 */
class UserOnboardingService {
  constructor() {
    this.activeOnboardings = new Map(); // userId -> status
  }

  /**
   * Start the complete onboarding process for a user
   * @param {string} userId - User ID to onboard
   * @param {object} options - Onboarding options
   * @returns {Promise<object>} Onboarding result
   */
  async startOnboarding(userId, options = {}) {
    const {
      maxTweets = 1000,
      includeReplies = false,
      skipIfExists = true // Skip if user already has data
    } = options;

    // Check if onboarding already running
    if (this.activeOnboardings.has(userId)) {
      const status = this.activeOnboardings.get(userId);
      return {
        status: 'already_running',
        currentStep: status.currentStep,
        progress: status.progress
      };
    }

    // Initialize status tracking
    const status = {
      userId,
      currentStep: 'initializing',
      progress: 0,
      startedAt: new Date(),
      steps: {
        collection: { status: 'pending', startedAt: null, completedAt: null },
        embedding: { status: 'pending', startedAt: null, completedAt: null },
        dossier: { status: 'pending', startedAt: null, completedAt: null },
        searches: { status: 'pending', startedAt: null, completedAt: null },
        live: { status: 'pending', startedAt: null, completedAt: null }
      },
      error: null
    };

    this.activeOnboardings.set(userId, status);

    // Run onboarding in background
    this._runOnboarding(userId, options, status).catch(error => {
      logger.error('Onboarding process failed', { userId, error: error.message, stack: error.stack });
      status.error = error.message;
      status.currentStep = 'failed';
    });

    return {
      status: 'started',
      userId,
      message: 'Onboarding process started in background'
    };
  }

  /**
   * Internal method to run the onboarding process
   */
  async _runOnboarding(userId, options, status) {
    const { maxTweets, includeReplies, skipIfExists } = options;

    try {
      // Get user info
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          tweets: { take: 1 },
          embedding: true,
          dossier: true
        }
      });

      if (!user) {
        throw new Error('User not found');
      }

      logger.system('Starting onboarding process', {
        userId,
        username: user.username,
        hasTweets: user.tweets.length > 0,
        hasEmbedding: !!user.embedding,
        hasDossier: !!user.dossier
      });

      // Step 1: Collect Tweets
      if (skipIfExists && user.tweets.length > 0) {
        logger.system('Skipping tweet collection - user already has tweets', { userId });
        status.steps.collection.status = 'skipped';
        status.progress = 20;
      } else {
        status.currentStep = 'collecting_tweets';
        status.steps.collection.status = 'running';
        status.steps.collection.startedAt = new Date();
        status.progress = 5;

        logger.system('Step 1: Collecting tweets', { userId, maxTweets });

        const collectionResult = await collectionService.startCollection(userId, {
          maxTweets,
          includeReplies
        });

        // Wait for collection to complete
        await this._waitForCollection(userId, collectionResult.collectionId);

        status.steps.collection.status = 'completed';
        status.steps.collection.completedAt = new Date();
        status.progress = 20;

        logger.system('Tweet collection completed', { userId });
      }

      // Step 2: Generate Embeddings
      if (skipIfExists && user.embedding) {
        logger.system('Skipping embedding generation - user already has embeddings', { userId });
        status.steps.embedding.status = 'skipped';
        status.progress = 40;
      } else {
        status.currentStep = 'generating_embeddings';
        status.steps.embedding.status = 'running';
        status.steps.embedding.startedAt = new Date();
        status.progress = 25;

        logger.system('Step 2: Generating embeddings', { userId });

        // Generate tweet embeddings
        // Create a job for embedding generation
        const embeddingJob = await prisma.dataCollection.create({
          data: {
            userId,
            collectionType: 'embeddings',
            status: 'running',
            startedAt: new Date()
          }
        });

        // Process embeddings
        await embeddingService.processUserTweetEmbeddings(userId, embeddingJob.id);

        status.steps.embedding.status = 'completed';
        status.steps.embedding.completedAt = new Date();
        status.progress = 40;

        logger.system('Embedding generation completed', { userId });
      }

      // Step 3: Generate Dossier
      if (skipIfExists && user.dossier) {
        logger.system('Skipping dossier generation - user already has dossier', { userId });
        status.steps.dossier.status = 'skipped';
        status.progress = 60;
      } else {
        status.currentStep = 'generating_dossier';
        status.steps.dossier.status = 'running';
        status.steps.dossier.startedAt = new Date();
        status.progress = 45;

        logger.system('Step 3: Generating dossier', { userId });

        // Call the dossier endpoint internally
        await this._generateDossier(userId);

        status.steps.dossier.status = 'completed';
        status.steps.dossier.completedAt = new Date();
        status.progress = 60;

        logger.system('Dossier generation completed', { userId });
      }

      // Step 4: Generate Search Suggestions
      status.currentStep = 'generating_searches';
      status.steps.searches.status = 'running';
      status.steps.searches.startedAt = new Date();
      status.progress = 65;

      logger.system('Step 4: Generating search suggestions', { userId });

      await this._generateSearches(userId);

      status.steps.searches.status = 'completed';
      status.steps.searches.completedAt = new Date();
      status.progress = 80;

      logger.system('Search suggestions completed', { userId });

      // Step 5: Generate LIVE Timeline
      status.currentStep = 'generating_live';
      status.steps.live.status = 'running';
      status.steps.live.startedAt = new Date();
      status.progress = 85;

      logger.system('Step 5: Generating LIVE timeline', { userId });

      await this._generateLiveTimeline(userId);

      status.steps.live.status = 'completed';
      status.steps.live.completedAt = new Date();
      status.progress = 100;

      logger.system('LIVE timeline generation completed', { userId });

      // Mark as completed
      status.currentStep = 'completed';
      status.completedAt = new Date();

      logger.system('Onboarding process completed successfully', {
        userId,
        duration: Date.now() - status.startedAt.getTime(),
        steps: Object.keys(status.steps).map(key => ({
          step: key,
          status: status.steps[key].status
        }))
      });

    } catch (error) {
      logger.error('Onboarding step failed', {
        userId,
        currentStep: status.currentStep,
        error: error.message,
        stack: error.stack
      });

      status.error = error.message;
      status.currentStep = 'failed';

      // Mark current step as failed
      const currentStepKey = this._getStepKey(status.currentStep);
      if (currentStepKey && status.steps[currentStepKey]) {
        status.steps[currentStepKey].status = 'failed';
        status.steps[currentStepKey].error = error.message;
      }

      throw error;
    }
  }

  /**
   * Wait for collection to complete
   */
  async _waitForCollection(userId, collectionId) {
    const maxWaitTime = 10 * 60 * 1000; // 10 minutes
    const startTime = Date.now();
    const pollInterval = 3000; // 3 seconds

    while (Date.now() - startTime < maxWaitTime) {
      const collection = await prisma.dataCollection.findUnique({
        where: { id: collectionId }
      });

      if (!collection) {
        throw new Error('Collection not found');
      }

      if (collection.status === 'completed') {
        return;
      }

      if (collection.status === 'failed') {
        throw new Error(`Collection failed: ${collection.error || 'Unknown error'}`);
      }

      // Still running, wait and check again
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('Collection timed out after 10 minutes');
  }

  /**
   * Generate dossier internally
   */
  async _generateDossier(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        tweets: {
          take: 5000,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            content: true,
            createdAt: true,
            metricsJson: true
          }
        }
      }
    });

    if (!user || !user.tweets.length) {
      throw new Error('No tweets found for dossier generation');
    }

    const recentTweets = user.tweets.map(t => ({
      id: t.id,
      content: t.content,
      date: t.createdAt,
      metrics: JSON.parse(t.metricsJson || '{}')
    }));

    const prompt = `You are a CIA analyst compiling a comprehensive dossier on the subject: ${user.username} (${user.displayName}).

Use the provided ${recentTweets.length} recent tweets to create a deep profile. Be objective, insightful, and detailed. Structure as a report with sections:

1. **Identity & Background**: Real identity, career, affiliations, key life events inferred from tweets.
2. **Personality & Traits**: Likes/dislikes, opinions (politics, tech, personal), communication style, humor/sarcasm.
3. **Interests & Patterns**: Topics engaged with, posting habits (time/frequency), audience interactions, viral content themes.
4. **Associations & Network**: Mentioned people/companies, collaborations, influences.
5. **Predictions & Risks**: Likely future behavior, content to engage/amplify, potential associations or red flags.
6. **Executive Summary**: 1-paragraph overview—strengths, motivations, watchlist potential.

Base analysis solely on tweets. Use evidence from content/dates/metrics. If data limited, note it.

Subject Tweets:
${recentTweets.map(t => `- [${t.date.toISOString().split('T')[0]}] ${t.content} (likes: ${t.metrics.like_count || 0})`).join('\n')}

Generate the dossier now.`;

    const aiProvider = AIProviderFactory.getProvider(config);
    if (!aiProvider.isConfigured()) {
      throw new Error('AI provider not configured');
    }

    const aiResponse = await aiProvider.ask(prompt, {
      users: [user],
      tweets: recentTweets
    });

    await prisma.dossier.upsert({
      where: { userId },
      update: {
        content: aiResponse.response,
        model: aiResponse.model,
        updatedAt: new Date()
      },
      create: {
        userId,
        content: aiResponse.response,
        model: aiResponse.model
      }
    });
  }

  /**
   * Generate search suggestions internally
   */
  async _generateSearches(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        dossier: {
          select: {
            content: true
          }
        }
      }
    });

    if (!user) {
      throw new Error('User not found');
    }

    const dossierContent = user.dossier?.content || user.description || '';

    const prompt = `Based on the following user profile, recommend 8-10 X (Twitter) search queries that would help discover:
1. Relevant content this user would find valuable and should engage with
2. New accounts they should follow
3. Conversations and communities aligned with their interests

User: @${user.username}
Profile Summary:
${dossierContent}

IMPORTANT REQUIREMENTS:
- Use ONLY X API v2 compatible search operators (NOT web search syntax)
- Focus on keywords, hashtags, and basic operators that work with the API
- API will automatically filter to last 7 days of recent tweets
- Keep queries simple and focused on content discovery

SUPPORTED OPERATORS (use these):
- Keywords and phrases (e.g., "artificial intelligence", "startup funding")
- Hashtags (e.g., #AI #MachineLearning)
- Boolean operators: AND, OR (use sparingly)
- Account mentions: from:username or @username
- Exclude terms: -word (to filter out)

DO NOT USE (these are web-only, not API compatible):
- min_faves, min_replies, min_retweets
- filter:verified, filter:media
- since:DATE, until:DATE (API handles time filtering)
- lang: operators

CRITICAL RULES:
- Do NOT use double quotes (") or single quotes (') inside the search strings
- Focus on ONE specific topic per query
- Keep queries simple with 2-5 keywords max
- Use hashtags when relevant to the topic

Example format:
["AI startup funding", "machine learning engineering", "#BuildInPublic indie hacker", "developer tools productivity", "AI automation", "crypto trading strategies", "remote work tips", "#DataScience analytics"]

Generate 8-10 search queries as a JSON array. Return ONLY the JSON array, no other text.`;

    const aiProvider = AIProviderFactory.getProvider(config);
    if (!aiProvider.isConfigured()) {
      throw new Error('AI provider not configured');
    }

    const aiResponse = await aiProvider.ask(prompt, {});

    // Parse the response as JSON
    let searches = [];
    try {
      const jsonMatch = aiResponse.response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        searches = JSON.parse(jsonMatch[0]);
      } else {
        searches = aiResponse.response
          .split('\n')
          .filter(line => line.trim() && !line.includes('{') && !line.includes('}'))
          .map(line => line.replace(/^[-*"\s]+|["]+$/g, '').trim())
          .filter(line => line.length > 0);
      }
    } catch (parseError) {
      logger.error('Failed to parse AI response for searches', {
        userId,
        response: aiResponse.response,
        error: parseError.message
      });
      searches = aiResponse.response
        .split('\n')
        .filter(line => line.trim().length > 10)
        .slice(0, 10);
    }

    await prisma.searchSuggestions.upsert({
      where: { userId },
      update: {
        searches: JSON.stringify(searches),
        model: aiResponse.model,
        updatedAt: new Date()
      },
      create: {
        userId,
        searches: JSON.stringify(searches),
        model: aiResponse.model
      }
    });
  }

  /**
   * Generate LIVE timeline internally
   */
  async _generateLiveTimeline(userId) {
    // This is a dummy implementation since LIVE timeline is typically generated on-demand
    // We just log that it's ready
    logger.system('LIVE timeline ready - searches generated', { userId });
  }

  /**
   * Get onboarding status for a user
   */
  getStatus(userId) {
    if (!this.activeOnboardings.has(userId)) {
      return {
        status: 'not_started',
        message: 'No onboarding process found for this user'
      };
    }

    return this.activeOnboardings.get(userId);
  }

  /**
   * Clear completed or failed onboarding
   */
  clearStatus(userId) {
    this.activeOnboardings.delete(userId);
  }

  /**
   * Get step key from step name
   */
  _getStepKey(stepName) {
    const mapping = {
      'collecting_tweets': 'collection',
      'generating_embeddings': 'embedding',
      'generating_dossier': 'dossier',
      'generating_searches': 'searches',
      'generating_live': 'live'
    };
    return mapping[stepName];
  }
}

export const userOnboardingService = new UserOnboardingService();
