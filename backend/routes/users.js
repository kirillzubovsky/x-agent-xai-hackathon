import { Router } from "express";
import { xAPI } from "../lib/twitter-api.js";
import { PrismaClient } from "@prisma/client";
import { logger } from "../../logger.js";
import { collectionService } from "../services/collection-service.js";
import { config } from "../config.js";
import { AIProviderFactory } from "../services/ai-providers/index.js";
import similarityService from "../services/similarity-service.js";
import { userOnboardingService } from "../services/user-onboarding-service.js";

const { cosineSimilarity } = similarityService;

const router = Router();
const prisma = new PrismaClient();

// Get all users
router.get("/", async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(users);
  } catch (error) {
    logger.error("Failed to get users", { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get or create user by username
router.post("/lookup", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: "Username required" });
    }

    const cleanUsername = username.replace("@", "");

    // Check database first
    let user = await prisma.user.findUnique({
      where: { username: cleanUsername },
    });

    if (!user) {
      // Fetch from API
      const apiUser = await xAPI.getUserByUsername(cleanUsername);
      if (!apiUser?.data) {
        return res
          .status(404)
          .json({ error: `User @${cleanUsername} not found on Twitter API` });
      }
      const userData = apiUser.data;

      // Check if user exists by twitterUserId to avoid unique constraint violation and keep data fresh
      let targetUser = user; // From username lookup
      const existingByTwitterId = await prisma.user.findUnique({
        where: { twitterUserId: userData.id }
      });
      if (existingByTwitterId) {
        logger.warn('User exists by twitterUserId (refreshing profile data)', { 
          username: cleanUsername, 
          twitterId: userData.id, 
          existingUsername: existingByTwitterId.username 
        });
        // Update existing user with fresh API data (idempotent)
        targetUser = await prisma.user.update({
          where: { id: existingByTwitterId.id },
          data: {
            username: cleanUsername, // Normalize username
            displayName: userData.name,
            description: userData.description || null,
            profileImageUrl: userData.profile_image_url || null,
            verified: userData.verified || false,
            verifiedType: userData.verified_type || null,
            followersCount: userData.public_metrics?.followers_count || 0,
            followingCount: userData.public_metrics?.following_count || 0,
            tweetCount: userData.public_metrics?.tweet_count || 0,
            listedCount: userData.public_metrics?.listed_count || 0,
            updatedAt: new Date(),
          }
        });
      } else if (!targetUser) {
        // Create new user
        targetUser = await prisma.user.create({
          data: {
            username: cleanUsername,
            twitterUserId: userData.id,
            displayName: userData.name,
            description: userData.description || null,
            profileImageUrl: userData.profile_image_url || null,
            verified: userData.verified || false,
            verifiedType: userData.verified_type || null,
            followersCount: userData.public_metrics?.followers_count || 0,
            followingCount: userData.public_metrics?.following_count || 0,
            tweetCount: userData.public_metrics?.tweet_count || 0,
            listedCount: userData.public_metrics?.listed_count || 0,
          }
        });
      } // If targetUser already from username lookup, optionally refresh it too
      else {
        logger.debug('User exists by username, refreshing profile', { username: cleanUsername });
        targetUser = await prisma.user.update({
          where: { id: targetUser.id },
          data: {
            displayName: userData.name,
            description: userData.description || null,
            profileImageUrl: userData.profile_image_url || null,
            verified: userData.verified || false,
            verifiedType: userData.verified_type || null,
            followersCount: userData.public_metrics?.followers_count || 0,
            followingCount: userData.public_metrics?.following_count || 0,
            tweetCount: userData.public_metrics?.tweet_count || 0,
            listedCount: userData.public_metrics?.listed_count || 0,
            updatedAt: new Date(),
          }
        });
      }
      user = targetUser;
    }

    res.json(user);
  } catch (error) {
    logger.error("Failed to lookup user", { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get user by ID
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: {
            tweets: true,
          },
        },
        embedding: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  } catch (error) {
    logger.error("Failed to get user", { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Start tweet collection for user
router.post("/:userId/collect", async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      maxTweets = config.collection.maxTweetsPerSession === 0
        ? Infinity
        : config.collection.maxTweetsPerSession || 10000,
      includeReplies = true,
    } = req.body;

    // Check if collection is already running in database
    const runningCollection = await prisma.dataCollection.findFirst({
      where: {
        userId,
        collectionType: "tweets",
        status: "running",
      },
    });

    if (runningCollection) {
      return res.status(400).json({
        error: "Collection already running for this user",
      });
    }

    // Start collection
    const result = await collectionService.startCollection(userId, {
      maxTweets,
      includeReplies,
    });

    if (result.status === "already_running") {
      return res.status(400).json({
        error: "Collection already in progress",
      });
    }

    res.json({
      message: "Collection started",
      status: result.status,
      collectionId: result.collectionId,
      username: result.username,
    });
  } catch (error) {
    logger.error("Failed to start collection", { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get collection status for user
router.get("/:userId/collection-status", async (req, res) => {
  try {
    const { userId } = req.params;

    const collections = await prisma.dataCollection.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    res.json(collections);
  } catch (error) {
    logger.error("Failed to get collection status", { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Resume an interrupted collection
router.post("/:userId/collect/resume", async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if collection is already running
    const runningCollection = await prisma.dataCollection.findFirst({
      where: {
        userId,
        collectionType: "tweets",
        status: "running",
      },
    });

    if (runningCollection) {
      return res.status(400).json({
        error: "Collection already running for this user",
      });
    }

    // Try to resume
    const result = await collectionService.resumeCollection(userId);

    if (result.status === "no_interrupted_collection") {
      return res.status(404).json({
        error: "No interrupted collection found for this user",
      });
    }

    res.json({
      message: "Collection resumed",
      status: result.status,
      collectionId: result.collectionId,
      username: result.username,
      previousItems: result.previousItems,
    });
  } catch (error) {
    logger.error("Failed to resume collection", { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Clear interrupted collection
router.delete("/:userId/collect/interrupted", async (req, res) => {
  try {
    const { userId } = req.params;
    const { collectionId } = req.query;

    const result = await collectionService.clearInterruptedCollection(
      userId,
      collectionId,
    );

    if (result.cleared === 0) {
      return res.status(404).json({
        error: "No interrupted collections found to clear",
      });
    }

    res.json({
      message: "Interrupted collection cleared",
      cleared: result.cleared,
    });
  } catch (error) {
    logger.error("Failed to clear interrupted collection", {
      error: error.message,
    });
    res.status(500).json({ error: error.message });
  }
});

// Get similar users
router.get("/:userId/similar", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 10 } = req.query;

    const similarities = await prisma.userSimilarity.findMany({
      where: {
        OR: [{ userId1: userId }, { userId2: userId }],
      },
      orderBy: { similarity: "desc" },
      take: parseInt(limit),
      include: {
        user1: true,
        user2: true,
      },
    });

    const similarUsers = similarities.map((s) => {
      const otherUser = s.userId1 === userId ? s.user2 : s.user1;
      return {
        ...otherUser,
        similarity: s.similarity,
      };
    });

    res.json(similarUsers);
  } catch (error) {
    logger.error("Failed to get similar users", { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get paginated followers for user
router.get("/:userId/followers", async (req, res) => {
  try {
    const { userId } = req.params;
    const { max_results = 1000, pagination_token } = req.query;

    const result = await xAPI.getUserFollowers(userId, {
      maxResults: parseInt(max_results),
      paginationToken: pagination_token,
    });

    res.json(result);
  } catch (error) {
    logger.error("Failed to get followers", { userId, error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Similar for following
router.get("/:userId/following", async (req, res) => {
  try {
    const { userId } = req.params;
    const { max_results = 1000, pagination_token } = req.query;

    const result = await xAPI.getUserFollowing(userId, {
      maxResults: parseInt(max_results),
      paginationToken: pagination_token,
    });

    res.json(result);
  } catch (error) {
    logger.error("Failed to get following", { userId, error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.post("/:userId/following-full", async (req, res) => {
  try {
    const { userId } = req.params;
    const { maxUsers = Infinity, userFields } = req.body;

    const following = await xAPI.getFullUserFollowing(userId, {
      maxUsers,
      userFields,
    });

    res.json({
      userId,
      total: following.length,
      data: following,
    });
  } catch (error) {
    logger.error("Failed to get full following", {
      userId,
      error: error.message,
    });
    res.status(500).json({ error: error.message });
  }
});

// Generate deep user profile dossier using Grok (CIA-style analysis from tweets)
router.post("/:userId/dossier", async (req, res) => {
  try {
    const { userId } = req.params;
    const { maxTweets = 5000 } = req.body;
    const regenerate = req.query.regenerate === "true"; // Force regeneration even if exists

    const result = await _generateDossierInternal(userId, maxTweets, regenerate);
    res.json(result);
  } catch (error) {
    logger.error("Failed to generate dossier", {
      userId: req.params.userId,
      error: error.message,
    });

    if (error.message === "User not found") {
      return res.status(404).json({ error: error.message });
    }
    if (error.message === "AI provider not configured") {
      return res.status(503).json({ error: error.message });
    }

    res.status(500).json({ error: error.message });
  }
});

// Generate suggested X searches based on user profile
router.post("/:userId/suggest-searches", async (req, res) => {
  try {
    const { userId } = req.params;

    // Fetch user and their dossier
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        dossier: {
          select: {
            content: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // If no dossier exists, generate one first
    if (!user.dossier) {
      logger.system("No dossier found, generating one first", { userId });
      await _generateDossierInternal(userId, 5000, false);

      // Refetch user with dossier
      const updatedUser = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          dossier: {
            select: {
              content: true,
              updatedAt: true,
            },
          },
        },
      });

      user.dossier = updatedUser.dossier;
    }

    const dossierContent = user.dossier?.content || user.description || "";

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

    // Use AI provider
    const aiProvider = AIProviderFactory.getProvider(config);
    if (!aiProvider.isConfigured()) {
      return res.status(503).json({ error: "AI provider not configured" });
    }

    const aiResponse = await aiProvider.ask(prompt, {});

    // Parse the response as JSON
    let searches = [];
    try {
      // Try to extract JSON array from response
      const jsonMatch = aiResponse.response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        searches = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback: split by newlines and filter
        searches = aiResponse.response
          .split('\n')
          .filter(line => line.trim() && !line.includes('{') && !line.includes('}'))
          .map(line => line.replace(/^[-*"\s]+|["]+$/g, '').trim())
          .filter(line => line.length > 0);
      }
    } catch (parseError) {
      logger.error("Failed to parse AI response for searches", {
        userId,
        response: aiResponse.response,
        error: parseError.message
      });
      // Fallback to basic parsing
      searches = aiResponse.response
        .split('\n')
        .filter(line => line.trim().length > 10)
        .slice(0, 10);
    }

    // Save searches to database
    const searchData = await prisma.searchSuggestions.upsert({
      where: { userId },
      update: {
        searches: JSON.stringify(searches),
        model: aiResponse.model,
        updatedAt: new Date(),
      },
      create: {
        userId,
        searches: JSON.stringify(searches),
        model: aiResponse.model,
      },
    });

    logger.system("Generated and saved search suggestions", {
      userId,
      searchCount: searches.length,
    });

    res.json({
      userId,
      searches,
      model: searchData.model,
      generatedAt: searchData.generatedAt,
      updatedAt: searchData.updatedAt,
    });
  } catch (error) {
    logger.error("Failed to generate search suggestions", {
      userId: req.params.userId,
      error: error.message,
    });

    res.status(500).json({ error: error.message });
  }
});

// Get saved search suggestions for a user
router.get("/:userId/searches", async (req, res) => {
  try {
    const { userId } = req.params;

    const searchData = await prisma.searchSuggestions.findUnique({
      where: { userId },
    });

    if (!searchData) {
      return res.json({
        userId,
        searches: [],
        hasSearches: false,
      });
    }

    const searches = JSON.parse(searchData.searches || "[]");

    res.json({
      userId,
      searches,
      model: searchData.model,
      generatedAt: searchData.generatedAt,
      updatedAt: searchData.updatedAt,
      hasSearches: true,
    });
  } catch (error) {
    logger.error("Failed to fetch search suggestions", {
      userId: req.params.userId,
      error: error.message,
    });

    res.status(500).json({ error: error.message });
  }
});

// Generate live timeline from saved searches
router.post("/:userId/live-timeline", async (req, res) => {
  try {
    const { userId } = req.params;

    logger.system('Starting live timeline generation', { userId });

    // Get user's saved searches
    const searchData = await prisma.searchSuggestions.findUnique({
      where: { userId },
    });

    if (!searchData || !searchData.searches) {
      return res.status(400).json({
        error: "No saved searches found. Generate search suggestions first."
      });
    }

    const searches = JSON.parse(searchData.searches || "[]");
    if (searches.length === 0) {
      return res.status(400).json({
        error: "No search queries available"
      });
    }

    // Get user's tweets from last 90 days for comparison
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const userTweets = await prisma.tweet.findMany({
      where: {
        userId,
        createdAt: { gte: ninetyDaysAgo },
        embedding: { isNot: null }
      },
      include: {
        embedding: true
      },
      orderBy: { createdAt: 'desc' }
    });

    if (userTweets.length === 0) {
      return res.status(400).json({
        error: "No tweets with embeddings found in the last 90 days. Collect and embed tweets first."
      });
    }

    logger.system('User tweets loaded for comparison', {
      userId,
      tweetCount: userTweets.length
    });

    // Convert user tweet embeddings to Float32Arrays
    const userEmbeddings = userTweets.map(tweet => ({
      tweet,
      vector: new Float32Array(
        tweet.embedding.vector.buffer,
        tweet.embedding.vector.byteOffset,
        tweet.embedding.vector.byteLength / 4
      )
    }));

    // Add 24-hour time filter to each search query
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
    const sinceDate = twentyFourHoursAgo.toISOString().split('T')[0]; // YYYY-MM-DD

    // Execute searches and collect tweets
    const allTweets = new Map(); // Use Map to deduplicate by tweet ID
    const searchProgress = [];

    for (let i = 0; i < searches.length; i++) {
      const searchQuery = searches[i];

      try {
        // The /tweets/search/recent endpoint supports these operators:
        // - Basic keywords and operators (AND, OR, NOT, quotes)
        // - Time filters (since:YYYY-MM-DD, until:YYYY-MM-DD)
        // - Advanced filters are NOT supported in v2 /search/recent:
        //   min_faves, min_replies, filter:verified are Twitter web syntax only

        // Clean the query to remove unsupported web-only operators
        let cleanedQuery = searchQuery
          .replace(/min_faves:\d+/g, '')
          .replace(/min_replies:\d+/g, '')
          .replace(/filter:verified/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        // Build proper API query with time filter
        // Use start_time parameter (ISO 8601 format) instead of since: operator
        const startTime = twentyFourHoursAgo.toISOString(); // Proper ISO format

        logger.system('Executing search query', {
          query: cleanedQuery,
          startTime,
          progress: `${i + 1}/${searches.length}`
        });

        // Search using X API with pagination to get up to 100 results per query
        // Note: /search/recent allows max_results up to 100 per request
        const searchResults = [];
        let nextToken = null;
        let totalFetched = 0;
        const maxResultsPerQuery = 100; // Can fetch up to 100 total results per search query

        // Paginate to get results (100 max for recent search)
        while (totalFetched < maxResultsPerQuery) {
          const response = await xAPI.searchTweets(cleanedQuery, {
            maxResults: 100,
            paginationToken: nextToken,
            startTime: startTime, // Use ISO 8601 timestamp
            sortOrder: 'recency', // Most recent first
            tweetFields: [
              'id',
              'text',
              'author_id',
              'created_at',
              'public_metrics',
              'context_annotations'
            ]
          });

          if (response.data && response.data.length > 0) {
            // Merge author info from includes
            const tweets = response.data.map(tweet => {
              const author = response.includes?.users?.find(u => u.id === tweet.author_id);
              return {
                ...tweet,
                username: author?.username || 'unknown',
                authorName: author?.name || 'Unknown'
              };
            });

            searchResults.push(...tweets);
            totalFetched += tweets.length;
          }

          // Check if there are more results
          if (response.nextToken && totalFetched < maxResultsPerQuery) {
            nextToken = response.nextToken;
          } else {
            break;
          }
        }

        searchProgress.push({
          query: searchQuery,
          results: searchResults.length,
          status: 'completed'
        });

        // Add tweets to map (deduplicates automatically)
        searchResults.forEach(tweet => {
          if (!allTweets.has(tweet.id)) {
            allTweets.set(tweet.id, tweet);
          }
        });

        logger.system('Search completed', {
          query: searchQuery,
          results: searchResults.length,
          totalUnique: allTweets.size
        });

      } catch (error) {
        logger.error('Search query failed', {
          query: searchQuery,
          error: error.message
        });
        searchProgress.push({
          query: searchQuery,
          results: 0,
          status: 'failed',
          error: error.message
        });
      }
    }

    const timelineTweets = Array.from(allTweets.values());
    logger.system('Timeline compiled', {
      totalSearches: searches.length,
      uniqueTweets: timelineTweets.length
    });

    if (timelineTweets.length === 0) {
      return res.json({
        userId,
        searchesExecuted: searches.length,
        searchProgress,
        timelineTweets: 0,
        matchingTweets: [],
        message: 'No tweets found in the last 24 hours matching your searches'
      });
    }

    // Generate embeddings for timeline tweets (in-memory, not saved to DB)
    const embeddingService = await import('../services/embedding-service.js');
    const matchingTweets = [];

    logger.system('Generating embeddings and computing similarities', {
      timelineTweets: timelineTweets.length,
      userTweets: userEmbeddings.length
    });

    for (let i = 0; i < timelineTweets.length; i++) {
      const tweet = timelineTweets[i];

      try {
        // Generate embedding for timeline tweet
        const tweetEmbedding = await embeddingService.default.generateEmbedding(tweet.text);

        // Compare with all user tweets to find best similarity
        let maxSimilarity = 0;
        let bestMatchTweet = null;

        for (const userEmbed of userEmbeddings) {
          const similarity = cosineSimilarity(tweetEmbedding, userEmbed.vector);
          if (similarity > maxSimilarity) {
            maxSimilarity = similarity;
            bestMatchTweet = userEmbed.tweet;
          }
        }

        // If similarity >= 60%, include in results
        if (maxSimilarity >= 0.6) {
          matchingTweets.push({
            tweet: {
              id: tweet.id,
              text: tweet.text,
              author: tweet.author_id,
              authorUsername: tweet.username,
              createdAt: tweet.created_at,
              metrics: tweet.public_metrics || {}
            },
            similarity: maxSimilarity,
            score: Math.round(maxSimilarity * 100),
            matchedWith: {
              id: bestMatchTweet.id,
              content: bestMatchTweet.content,
              createdAt: bestMatchTweet.createdAt
            }
          });
        }

        // Log progress every 10 tweets
        if ((i + 1) % 10 === 0) {
          logger.system('Embedding progress', {
            processed: i + 1,
            total: timelineTweets.length,
            matches: matchingTweets.length
          });
        }

      } catch (error) {
        logger.error('Failed to process tweet embedding', {
          tweetId: tweet.id,
          error: error.message
        });
      }
    }

    // Sort by similarity (highest first)
    matchingTweets.sort((a, b) => b.similarity - a.similarity);

    logger.system('Live timeline generation completed', {
      userId,
      searchesExecuted: searches.length,
      timelineTweets: timelineTweets.length,
      matchingTweets: matchingTweets.length,
      averageSimilarity: matchingTweets.length > 0
        ? (matchingTweets.reduce((sum, t) => sum + t.similarity, 0) / matchingTweets.length).toFixed(2)
        : 0
    });

    res.json({
      userId,
      searchesExecuted: searches.length,
      searchProgress,
      timelineTweets: timelineTweets.length,
      matchingTweets,
      threshold: 0.6,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to generate live timeline', {
      userId: req.params.userId,
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({ error: error.message });
  }
});

// GET /api/users/:userId/metrics – Aggregate tweet metrics for dashboard
router.get('/:userId/metrics', async (req, res) => {
  try {
    const { userId } = req.params;
    const days = parseInt(req.query.days) || 90; // Changed to 90 days
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const tweets = await prisma.tweet.findMany({
      where: {
        userId,
        createdAt: { gte: startDate },
        isDeleted: false
      },
      select: {
        createdAt: true,
        metricsJson: true
      },
      orderBy: { createdAt: 'asc' }
    });

    // Aggregate daily metrics
    const dailyData = {};
    let totalViews = 0, totalLikes = 0, totalEngagements = 0;
    tweets.forEach(t => {
      const parsed = JSON.parse(t.metricsJson || '{}');
      // Handle both flat structure and public_metrics wrapper
      const metrics = parsed.public_metrics || parsed;
      const date = t.createdAt.toISOString().split('T')[0];
      dailyData[date] = dailyData[date] || { views: 0, likes: 0, engagements: 0 };
      const views = metrics.impression_count || 0;
      const likes = metrics.like_count || 0;
      const engagements = likes + (metrics.retweet_count || 0) + (metrics.reply_count || 0) + (metrics.quote_count || 0);
      dailyData[date].views += views;
      dailyData[date].likes += likes;
      dailyData[date].engagements += engagements;
      totalViews += views;
      totalLikes += likes;
      totalEngagements += engagements;
    });

    const numDays = Object.keys(dailyData).length;
    const avgDailyViews = numDays > 0 ? totalViews / numDays : 0;
    const avgDailyLikes = numDays > 0 ? totalLikes / numDays : 0;
    const avgEngagements = numDays > 0 ? totalEngagements / numDays : 0;

    // Sort daily data by date (oldest first)
    const sortedDailyData = Object.entries(dailyData).sort(([a], [b]) => a.localeCompare(b));
    const dailyValues = sortedDailyData.map(([date, data]) => data);

    // Helper function to calculate momentum and percentile for a metric
    const calculateMetricStats = (metricName) => {
      const recentPeriod = dailyValues.slice(-7); // Last 7 days
      const baselinePeriod = dailyValues.slice(-37, -7); // Days 8-37 (previous 30 days)

      const recentAvg = recentPeriod.length > 0
        ? recentPeriod.reduce((sum, d) => sum + d[metricName], 0) / recentPeriod.length
        : 0;
      const baselineAvg = baselinePeriod.length > 0
        ? baselinePeriod.reduce((sum, d) => sum + d[metricName], 0) / baselinePeriod.length
        : 0;

      const momentumChange = baselineAvg > 0
        ? ((recentAvg - baselineAvg) / baselineAvg) * 100
        : 0;
      const momentumDirection = momentumChange > 5 ? 'up' : momentumChange < -5 ? 'down' : 'stable';

      // Calculate percentile ranking
      const allDailyValues = dailyValues.map(d => d[metricName]).sort((a, b) => a - b);
      const percentileRank = allDailyValues.length > 0
        ? (allDailyValues.filter(v => v <= recentAvg).length / allDailyValues.length) * 100
        : 50;

      let performanceTier = 'median';
      if (percentileRank >= 75) performanceTier = 'top';
      else if (percentileRank >= 50) performanceTier = 'above median';
      else if (percentileRank >= 25) performanceTier = 'below median';
      else performanceTier = 'bottom';

      return {
        momentum: {
          recentAvg: Math.round(recentAvg),
          baselineAvg: Math.round(baselineAvg),
          change: Math.round(momentumChange * 10) / 10,
          direction: momentumDirection,
          period: 'Last 7 days vs previous 30 days'
        },
        percentile: {
          rank: Math.round(percentileRank),
          tier: performanceTier,
          description: `Recent performance is in the ${performanceTier === 'top' ? 'top 25%' : performanceTier === 'bottom' ? 'bottom 25%' : performanceTier}`
        }
      };
    };

    // Calculate for all three metrics
    const viewsStats = calculateMetricStats('views');
    const likesStats = calculateMetricStats('likes');
    const engagementsStats = calculateMetricStats('engagements');

    // Simple linear regression for views
    const regressionViews = computeSimpleRegression(dailyValues.map(d => d.views));

    res.json({
      userId,
      periodDays: days,
      totals: { totalViews, totalLikes, totalEngagements },
      averages: { avgDailyViews, avgDailyLikes, avgEngagements },
      dailyData: sortedDailyData.map(([date, data]) => ({ date, ...data })).reverse(), // Recent first for display
      views: viewsStats,
      likes: likesStats,
      engagements: engagementsStats,
      regression: {
        views: regressionViews
      }
    });
  } catch (error) {
    logger.error('Failed to get user metrics', { userId, error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// GET /api/users/:userId/similar-accounts – Discover similar users using embeddings + API candidates
router.get('/:userId/similar-accounts', async (req, res) => {
  const { userId } = req.params; // Move outside for catch scope
  try {
    const limit = parseInt(req.query.limit) || 10;
    const minSim = parseFloat(req.query.minSim) || 0.6;
    const maxCandidates = parseInt(req.query.maxCandidates) || 50;
    const mode = req.query.mode || 'followers'; // 'followers' | 'search'
    const autoCollect = req.query.autoCollect === 'true';
    const useDossierSim = req.query.useDossierSim === 'true'; // Combine with text sim from dossier
    const forceRefresh = req.query.forceRefresh === 'true'; // Force recalculation

    logger.system('Finding similar accounts', {
      targetUserId: userId,
      limit,
      minSim,
      mode,
      forceRefresh,
      autoCollect
    });

    // Check for cached results first (unless forceRefresh)
    if (!forceRefresh) {
      const cachedSimilarities = await prisma.userSimilarity.findMany({
        where: {
          userId1: userId,
          similarity: { gte: minSim }
        },
        include: {
          user2: {
            select: {
              id: true,
              username: true,
              displayName: true,
              description: true
            }
          }
        },
        orderBy: { similarity: 'desc' },
        take: limit
      });

      if (cachedSimilarities.length > 0) {
        logger.system('Returning cached similar accounts', { userId, count: cachedSimilarities.length });
        const topSimilar = cachedSimilarities.map(cs => ({
          user: {
            id: cs.user2.id,
            username: cs.user2.username,
            displayName: cs.user2.displayName,
            description: cs.user2.description,
            similarity: cs.similarity,
            score: Math.round(cs.similarity * 100)
          },
          embeddingSim: cs.similarity,
          isNew: false
        }));

        return res.json({
          targetUserId: userId,
          mode: 'cached',
          candidatesChecked: 0,
          topSimilar,
          minSim,
          alerts: 0,
          fromCache: true
        });
      }
    }

    // Get target user data
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { embedding: true, dossier: true }
    });
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!targetUser.embedding) {
      return res.status(400).json({ error: 'User embedding not found – collect tweets and generate embedding first' });
    }

    logger.system('Target user loaded', {
      targetUserId: userId,
      targetUsername: targetUser.username,
      hasEmbedding: !!targetUser.embedding,
      hasDossier: !!targetUser.dossier
    });
    // Convert Buffer to Float32Array for similarity computation
    const targetVector = new Float32Array(
      targetUser.embedding.vector.buffer,
      targetUser.embedding.vector.byteOffset,
      targetUser.embedding.vector.byteLength / 4
    );
    const targetDossier = targetUser.dossier?.content || ''; // For text sim

    // Step 1: Get candidates
    const candidates = await getSimilarCandidates(userId, maxCandidates, mode, targetDossier); // Enhanced helper

    logger.system('Candidates loaded', {
      targetUserId: userId,
      targetUsername: targetUser.username,
      candidateCount: candidates.length,
      candidateUsernames: candidates.slice(0, 5) // Show first 5
    });

    // Step 2: Compute similarities (embedding + optional dossier text sim)
    const similarities = [];
    for (const candidateUsername of candidates) {
      const candidateUser = await getOrCreateUser(candidateUsername);
      if (candidateUser && candidateUser.embedding) {
        // Convert Buffer to Float32Array for similarity computation
        const candidateVector = new Float32Array(
          candidateUser.embedding.vector.buffer,
          candidateUser.embedding.vector.byteOffset,
          candidateUser.embedding.vector.byteLength / 4
        );

        let sim = cosineSimilarity(targetVector, candidateVector);

        if (useDossierSim && candidateUser.dossier && targetDossier) {
          // Additional text sim (embed dossier texts)
          const dossierSim = await computeDossierSimilarity(targetDossier, candidateUser.dossier.content);
          sim = (sim + dossierSim) / 2; // Average scores
        }

        if (sim >= minSim) {
          logger.system('High similarity found', {
            targetUsername: targetUser.username,
            candidateUsername: candidateUser.username,
            similarity: sim.toFixed(4)
          });

          similarities.push({
            user: {
              id: candidateUser.id,
              username: candidateUser.username,
              displayName: candidateUser.displayName,
              description: candidateUser.description,
              similarity: sim,
              score: Math.round(sim * 100)
            },
            embeddingSim: sim, // Or separate
            isNew: !candidateUser.embedding.createdAt || candidateUser.embedding.createdAt < new Date(Date.now() - 24*60*60*1000) // Cached <24h?
          });
        }
      }
    }

    // Step 3: Rank, limit, alerts for high sim
    similarities.sort((a, b) => b.similarity - a.similarity);
    const topSimilar = similarities.slice(0, limit);
    const highSimAlerts = topSimilar.filter(s => s.similarity > 0.8);
    if (highSimAlerts.length > 0) {
      logger.system('High similarity alerts', { userId, highSim: highSimAlerts.map(s => s.user.username) });
      // Optional: Send notification (e.g., to frontend or email)
    }

    // Save similarity scores to database for caching
    for (const sim of topSimilar) {
      await prisma.userSimilarity.upsert({
        where: {
          userId1_userId2: {
            userId1: userId,
            userId2: sim.user.id
          }
        },
        update: {
          similarity: sim.user.similarity || sim.similarity || 0
        },
        create: {
          userId1: userId,
          userId2: sim.user.id,
          similarity: sim.user.similarity || sim.similarity || 0
        }
      });
    }

    logger.system('Saved similarity scores to database', {
      targetUserId: userId,
      count: topSimilar.length,
      topUsernames: topSimilar.slice(0, 3).map(s => s.user.username)
    });

    // Step 4: Auto-collect top ones
    if (autoCollect) {
      for (const sim of topSimilar.slice(0, 3)) {
        await collectionService.startCollection(sim.user.id);
        // Generate dossier if not exists or old (>24h)
        if (!sim.user.dossier || !sim.user.dossier.generatedAt || sim.user.dossier.generatedAt < new Date(Date.now() - 24 * 60 * 60 * 1000)) {
          await _generateDossierInternal(sim.user.id, 5000, false);
        }
      }
    }

    res.json({
      targetUserId: userId,
      mode,
      candidatesChecked: candidates.length,
      topSimilar,
      minSim,
      alerts: highSimAlerts.length
    });
  } catch (error) {
    logger.error('Failed to find similar accounts', {
      userId,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message, details: error.stack });
  }
});

// Shared internal dossier generation logic
async function _generateDossierInternal(userId, maxTweets = 5000, regenerate = false) {
  // Check for existing dossier
  const existingDossier = await prisma.dossier.findUnique({
    where: { userId },
    select: {
      id: true,
      content: true,
      model: true,
      generatedAt: true,
      updatedAt: true,
    },
  });

  if (existingDossier && !regenerate) {
    logger.system("Returning cached dossier", {
      userId,
      generatedAt: existingDossier.generatedAt,
    });
    return {
      userId,
      tweetCount: 0,
      dossier: existingDossier.content,
      model: existingDossier.model,
      generatedAt: existingDossier.generatedAt,
      updatedAt: existingDossier.updatedAt,
      fromCache: true,
    };
  }

  // Fetch user and recent tweets from DB
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      tweets: {
        take: maxTweets,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          content: true,
          createdAt: true,
          metricsJson: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  if (!user.tweets.length) {
    throw new Error("No tweets found for user");
  }

  const recentTweets = user.tweets.map((t) => ({
    id: t.id,
    content: t.content,
    date: t.createdAt,
    metrics: JSON.parse(t.metricsJson || "{}"),
  }));

  const context = {
    users: [user],
    tweets: recentTweets,
  };

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
${recentTweets.map((t) => `- [${t.date.toISOString().split("T")[0]}] ${t.content} (likes: ${t.metrics.like_count || 0})`).join("\n")}

Generate the dossier now.`;

  // Use AI provider (Grok preferred)
  const aiProvider = AIProviderFactory.getProvider(config);
  if (!aiProvider.isConfigured()) {
    throw new Error("AI provider not configured");
  }

  const aiResponse = await aiProvider.ask(prompt, context);

  // Save or update dossier
  const dossierData = await prisma.dossier.upsert({
    where: { userId },
    update: {
      content: aiResponse.response,
      model: aiResponse.model,
      updatedAt: new Date(),
    },
    create: {
      userId,
      content: aiResponse.response,
      model: aiResponse.model,
    },
  });

  logger.system("Dossier generated and saved", {
    userId,
    tweetCount: recentTweets.length,
    regenerated: true,
  });

  return {
    userId,
    tweetCount: recentTweets.length,
    dossier: dossierData.content,
    model: dossierData.model,
    generatedAt: dossierData.generatedAt,
    updatedAt: dossierData.updatedAt,
    regenerated: true,
  };
}

// Enhanced helpers (add below previous helpers)
async function getSimilarCandidates(userId, max, mode, targetDossier) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return [];

  try {
    if (mode === 'followers') {
      // Get stored users from database who have embeddings
      // This includes followers we've stored + any other users with embeddings
      logger.system('Finding similar candidates from database', { userId, max, mode });

      const usersWithEmbeddings = await prisma.user.findMany({
        where: {
          id: { not: userId }, // Exclude the target user
          embedding: {
            isNot: null // Only users with embeddings
          }
        },
        select: {
          username: true,
          displayName: true,
          followersCount: true
        },
        orderBy: {
          followersCount: 'desc' // Prioritize high-follower accounts
        },
        take: max
      });

      logger.system('Found candidates with embeddings', {
        userId,
        count: usersWithEmbeddings.length,
        requested: max
      });

      return usersWithEmbeddings.map(u => u.username);
    } else if (mode === 'search') {
      // TODO: Implement keyword-based search using extractKeywordsFromDossier
      // For now, use same logic as followers mode
      logger.system('Search mode not fully implemented, using followers mode', { userId });

      const usersWithEmbeddings = await prisma.user.findMany({
        where: {
          id: { not: userId },
          embedding: {
            isNot: null
          }
        },
        select: {
          username: true
        },
        orderBy: {
          followersCount: 'desc'
        },
        take: max
      });

      return usersWithEmbeddings.map(u => u.username);
    }
  } catch (error) {
    logger.error('Failed to get similar candidates', { userId, mode, error: error.message });
    return [];
  }

  return [];
}

// Helper: Compute similarity between dossier texts
async function computeDossierSimilarity(dossier1, dossier2) {
  try {
    // Import embedding service
    const embeddingService = await import('../services/embedding-service.js');

    // Generate embeddings for both dossier texts
    const [embedding1, embedding2] = await Promise.all([
      embeddingService.default.generateEmbedding(dossier1),
      embeddingService.default.generateEmbedding(dossier2)
    ]);

    // Compute cosine similarity
    const similarity = cosineSimilarity(embedding1, embedding2);

    return similarity;
  } catch (error) {
    logger.error('Failed to compute dossier similarity', { error: error.message });
    return 0;
  }
}

// Helper: Get or create user
async function getOrCreateUser(username) {
  const cleanUsername = username.replace('@', '');
  let user = await prisma.user.findUnique({
    where: { username: cleanUsername },
    include: { embedding: true, dossier: true }
  });
  if (!user) {
    try {
      const apiUser = await xAPI.getUserByUsername(cleanUsername);
      if (!apiUser?.data) {
        logger.warn('Candidate user not found on Twitter', { username: cleanUsername });
        return null; // Skip
      }
      const userData = apiUser.data;
      user = await prisma.user.create({
        data: {
          username: cleanUsername,
          twitterUserId: userData.id,
          displayName: userData.name,
          description: userData.description || null,
          profileImageUrl: userData.profile_image_url || null,
          verified: userData.verified || false,
          verifiedType: userData.verified_type || null,
          followersCount: userData.public_metrics?.followers_count || 0,
          followingCount: userData.public_metrics?.following_count || 0,
          tweetCount: userData.public_metrics?.tweet_count || 0,
          listedCount: userData.public_metrics?.listed_count || 0,
        }
      });
      logger.system('Created new candidate user for similarity', { username: cleanUsername });
    } catch (error) {
      logger.error('Failed to create candidate user', { username: cleanUsername, error });
      return null;
    }
  }
  return user;
}

// Helper: Generate dossier (wrapper for internal function)
async function generateDossier(userId, maxTweets = 5000) {
  try {
    // Use shared internal function with regenerate=true to force generation
    await _generateDossierInternal(userId, maxTweets, true);
    logger.system('Dossier generated for candidate', { userId });
  } catch (error) {
    logger.error('Failed to generate dossier for candidate', { userId, error: error.message });
  }
}

// Helper: Extract keywords for search (optional, using embedding-service or AI)
async function extractKeywordsFromDossier(userId) {
  // Use grok-provider or ollama to analyze dossier/tweets for topics
  // Return ['AI', 'xAI', 'Grok']
}

// Note: Add imports at top: import { xAPI } from '../lib/twitter-api.js'; import { collectionService } from '../services/collection-service.js'; import { cosineSimilarity } from '../services/similarity-service.js'; etc.


// Helper for linear regression
function computeSimpleRegression(values) {
  const n = values.length;
  if (n < 2) return { slope: 0, lastValue: values[0] || 0, trend: 'flat' };
  const sumX = n * (n + 1) / 2;
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = values.reduce((sum, y, i) => sum + (i + 1) * y, 0);
  const sumX2 = n * (n + 1) * (2 * n + 1) / 6;
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const trend = slope > 0.01 ? 'upward' : slope < -0.01 ? 'downward' : 'flat';
  const lastValue = values[values.length - 1];
  return { slope: Math.round(slope * 100) / 100, lastValue, trend };
}

router.post('/:userId/followers-full', async (req, res) => {
  try {
    const { userId } = req.params;
    const { maxUsers = Infinity, userFields, storeFollowers = true } = req.body;

    // Lookup Twitter ID from Prisma user ID
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const twitterUserId = user.twitterUserId;

    logger.api('Fetching full followers for user', { userId, twitterUserId, maxUsers, storeFollowers });

    const followers = await xAPI.getFullUserFollowers(twitterUserId, { maxUsers, userFields });

    // Store followers in database if requested
    let storedCount = 0;
    if (storeFollowers && followers.length > 0) {
      logger.system('Storing followers in database', { userId, followerCount: followers.length });

      for (const follower of followers) {
        try {
          // Check if follower already exists
          const existingUser = await prisma.user.findUnique({
            where: { twitterUserId: follower.id }
          });

          if (!existingUser) {
            // Create new user record for follower
            await prisma.user.create({
              data: {
                twitterUserId: follower.id,
                username: follower.username,
                displayName: follower.name,
                description: follower.description || null,
                profileImageUrl: follower.profile_image_url || null,
                verified: follower.verified || false,
                verifiedType: follower.verified_type || null,
                followersCount: follower.public_metrics?.followers_count || 0,
                followingCount: follower.public_metrics?.following_count || 0,
                tweetCount: follower.public_metrics?.tweet_count || 0,
                listedCount: follower.public_metrics?.listed_count || 0,
              }
            });
            storedCount++;
          } else {
            // Update existing user with fresh data
            await prisma.user.update({
              where: { id: existingUser.id },
              data: {
                username: follower.username,
                displayName: follower.name,
                description: follower.description || null,
                profileImageUrl: follower.profile_image_url || null,
                verified: follower.verified || false,
                verifiedType: follower.verified_type || null,
                followersCount: follower.public_metrics?.followers_count || 0,
                followingCount: follower.public_metrics?.following_count || 0,
                tweetCount: follower.public_metrics?.tweet_count || 0,
                listedCount: follower.public_metrics?.listed_count || 0,
                updatedAt: new Date(),
              }
            });
          }

          // Create follower relation
          const followerUser = existingUser || await prisma.user.findUnique({ where: { twitterUserId: follower.id } });
          if (followerUser) {
            await prisma.followerRelation.upsert({
              where: { userId_followerId: { userId, followerId: followerUser.id } },
              update: {},
              create: { userId, followerId: followerUser.id }
            });
          }
        } catch (error) {
          logger.error('Failed to store follower', {
            followerUsername: follower.username,
            error: error.message
          });
          // Continue with other followers even if one fails
        }
      }

      logger.system('Followers stored in database', {
        userId,
        totalFetched: followers.length,
        newlyStored: storedCount
      });
    }

    res.json({
      userId,
      twitterUserId,
      total: followers.length,
      stored: storeFollowers ? storedCount : 0,
      data: followers
    });
  } catch (error) {
    logger.error('Failed to get full followers', { userId, error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get stored followers from database (no API call)
router.get('/:userId/stored-followers', async (req, res) => {
  try {
    const { userId } = req.params;

    const relations = await prisma.followerRelation.findMany({
      where: { userId },
      include: {
        follower: {
          select: {
            id: true,
            twitterUserId: true,
            username: true,
            displayName: true,
            description: true,
            profileImageUrl: true,
            verified: true,
            verifiedType: true,
            followersCount: true,
            followingCount: true,
            tweetCount: true,
            listedCount: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const followers = relations.map(r => ({
      id: r.follower.twitterUserId,
      username: r.follower.username,
      name: r.follower.displayName,
      description: r.follower.description,
      profile_image_url: r.follower.profileImageUrl,
      verified: r.follower.verified,
      verified_type: r.follower.verifiedType,
      public_metrics: {
        followers_count: r.follower.followersCount,
        following_count: r.follower.followingCount,
        tweet_count: r.follower.tweetCount,
        listed_count: r.follower.listedCount,
      },
      _dbId: r.follower.id,
    }));

    res.json({ userId, total: followers.length, data: followers });
  } catch (error) {
    logger.error('Failed to get stored followers', { userId: req.params.userId, error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Sync follower relations from X API (cheap - only fetches IDs, not full profiles)
router.post('/:userId/sync-follower-ids', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    logger.api('Syncing follower IDs for user', { userId, twitterUserId: user.twitterUserId });

    // Fetch all follower IDs from X API (cheap - just IDs)
    const followers = await xAPI.getFullUserFollowers(user.twitterUserId, { maxUsers: Infinity });

    let linkedCount = 0;
    for (const follower of followers) {
      try {
        const existingUser = await prisma.user.findUnique({ where: { twitterUserId: follower.id } });
        if (existingUser) {
          await prisma.followerRelation.upsert({
            where: { userId_followerId: { userId, followerId: existingUser.id } },
            update: {},
            create: { userId, followerId: existingUser.id }
          });
          linkedCount++;
        }
      } catch (err) {
        // skip individual errors
      }
    }

    logger.system('Follower IDs synced', { userId, totalFromApi: followers.length, linkedInDb: linkedCount });
    res.json({ userId, totalFromApi: followers.length, linkedInDb: linkedCount });
  } catch (error) {
    logger.error('Failed to sync follower IDs', { userId: req.params.userId, error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get full blocking list (users blocked by the target user)
router.post('/:userId/blocking-full', async (req, res) => {
  try {
    const { userId } = req.params;
    const { maxUsers = Infinity, userFields, storeBlocked = true } = req.body;

    // Lookup Twitter ID from Prisma user ID
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const twitterUserId = user.twitterUserId;

    logger.api('Fetching full blocking list for user', { userId, twitterUserId, maxUsers, storeBlocked });

    const blocked = await xAPI.getFullUserBlocking(twitterUserId, { maxUsers, userFields });

    // Store blocked users in database if requested
    let storedCount = 0;
    if (storeBlocked && blocked.length > 0) {
      logger.system('Storing blocked users in database', { userId, blockedCount: blocked.length });

      for (const blockedUser of blocked) {
        try {
          // Check if blocked user already exists
          const existingUser = await prisma.user.findUnique({
            where: { twitterUserId: blockedUser.id }
          });

          if (!existingUser) {
            // Create new user record for blocked user
            await prisma.user.create({
              data: {
                twitterUserId: blockedUser.id,
                username: blockedUser.username,
                displayName: blockedUser.name,
                description: blockedUser.description || null,
                profileImageUrl: blockedUser.profile_image_url || null,
                verified: blockedUser.verified || false,
                verifiedType: blockedUser.verified_type || null,
                followersCount: blockedUser.public_metrics?.followers_count || 0,
                followingCount: blockedUser.public_metrics?.following_count || 0,
                tweetCount: blockedUser.public_metrics?.tweet_count || 0,
                listedCount: blockedUser.public_metrics?.listed_count || 0,
              }
            });
            storedCount++;
          } else {
            // Update existing user with fresh data
            await prisma.user.update({
              where: { id: existingUser.id },
              data: {
                username: blockedUser.username,
                displayName: blockedUser.name,
                description: blockedUser.description || null,
                profileImageUrl: blockedUser.profile_image_url || null,
                verified: blockedUser.verified || false,
                verifiedType: blockedUser.verified_type || null,
                followersCount: blockedUser.public_metrics?.followers_count || 0,
                followingCount: blockedUser.public_metrics?.following_count || 0,
                tweetCount: blockedUser.public_metrics?.tweet_count || 0,
                listedCount: blockedUser.public_metrics?.listed_count || 0,
                updatedAt: new Date(),
              }
            });
          }
        } catch (error) {
          logger.error('Failed to store blocked user', {
            blockedUsername: blockedUser.username,
            error: error.message
          });
          // Continue with other blocked users even if one fails
        }
      }

      logger.system('Blocked users stored in database', {
        userId,
        totalFetched: blocked.length,
        newlyStored: storedCount
      });
    }

    res.json({
      userId,
      twitterUserId,
      total: blocked.length,
      stored: storeBlocked ? storedCount : 0,
      data: blocked
    });
  } catch (error) {
    logger.error('Failed to get blocking list', { userId, error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Start complete onboarding process for a user
router.post('/:userId/onboard', async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      maxTweets = 1000,
      includeReplies = false,
      skipIfExists = true
    } = req.body;

    logger.system('Starting user onboarding', {
      userId,
      maxTweets,
      includeReplies,
      skipIfExists
    });

    const result = await userOnboardingService.startOnboarding(userId, {
      maxTweets,
      includeReplies,
      skipIfExists
    });

    res.json(result);
  } catch (error) {
    logger.error('Failed to start onboarding', {
      userId: req.params.userId,
      error: error.message
    });
    res.status(500).json({ error: error.message });
  }
});

// Get onboarding status for a user
router.get('/:userId/onboard/status', async (req, res) => {
  try {
    const { userId } = req.params;
    const status = userOnboardingService.getStatus(userId);
    res.json(status);
  } catch (error) {
    logger.error('Failed to get onboarding status', {
      userId: req.params.userId,
      error: error.message
    });
    res.status(500).json({ error: error.message });
  }
});

// Clear onboarding status (after completion or failure)
router.delete('/:userId/onboard/status', async (req, res) => {
  try {
    const { userId } = req.params;
    userOnboardingService.clearStatus(userId);
    res.json({ message: 'Onboarding status cleared' });
  } catch (error) {
    logger.error('Failed to clear onboarding status', {
      userId: req.params.userId,
      error: error.message
    });
    res.status(500).json({ error: error.message });
  }
});

export default router;
