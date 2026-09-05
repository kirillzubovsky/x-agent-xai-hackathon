import { PrismaClient } from '@prisma/client';
import { logger } from '../../logger.js';

const prisma = new PrismaClient();

/**
 * Safely convert a Prisma Bytes (Buffer) to Float32Array.
 * Node.js pool-allocated Buffers may have non-4-byte-aligned offsets,
 * so we copy into a fresh ArrayBuffer to guarantee alignment.
 */
function bufferToFloat32Array(buf) {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab);
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Find similar tweets between two users
 */
export async function findSimilarTweetsBetweenUsers(userId1, userId2, minSimilarity = 0.7, limit = 50) {
  try {
    logger.system('Finding similar tweets between users', { userId1, userId2, minSimilarity });

    // Get embeddings for both users
    const [user1Embeddings, user2Embeddings] = await Promise.all([
      prisma.embedding.findMany({
        where: {
          tweet: { userId: userId1 }
        },
        include: {
          tweet: {
            include: { user: true }
          }
        }
      }),
      prisma.embedding.findMany({
        where: {
          tweet: { userId: userId2 }
        },
        include: {
          tweet: {
            include: { user: true }
          }
        }
      })
    ]);

    if (user1Embeddings.length === 0 || user2Embeddings.length === 0) {
      logger.system('No embeddings found for one or both users');
      return [];
    }

    // Calculate similarities
    const similarities = [];

    for (const embed1 of user1Embeddings) {
      const vec1 = bufferToFloat32Array(embed1.vector);
      for (const embed2 of user2Embeddings) {
        const similarity = cosineSimilarity(vec1, bufferToFloat32Array(embed2.vector));

        if (similarity >= minSimilarity) {
          similarities.push({
            tweet1: embed1.tweet,
            tweet2: embed2.tweet,
            similarity,
            tweet1Id: embed1.tweetId,
            tweet2Id: embed2.tweetId
          });
        }
      }
    }

    // Sort by similarity and limit
    similarities.sort((a, b) => b.similarity - a.similarity);
    const topSimilarities = similarities.slice(0, limit);

    logger.system('Found similar tweets', {
      totalComparisons: user1Embeddings.length * user2Embeddings.length,
      aboveThreshold: similarities.length,
      returned: topSimilarities.length
    });

    return topSimilarities;
  } catch (error) {
    logger.error('Failed to find similar tweets between users', { error: error.message });
    throw error;
  }
}

/**
 * Find similar tweets for a single user (internal similarity)
 */
export async function findSimilarTweetsForUser(userId, minSimilarity = 0.8, limit = 50) {
  try {
    logger.system('Finding similar tweets for user', { userId, minSimilarity });

    const embeddings = await prisma.embedding.findMany({
      where: {
        tweet: { userId }
      },
      include: {
        tweet: true
      }
    });

    if (embeddings.length < 2) {
      return [];
    }

    const similarities = [];

    // Compare each tweet with every other tweet
    for (let i = 0; i < embeddings.length - 1; i++) {
      const vecI = bufferToFloat32Array(embeddings[i].vector);
      for (let j = i + 1; j < embeddings.length; j++) {
        const similarity = cosineSimilarity(vecI, bufferToFloat32Array(embeddings[j].vector));

        if (similarity >= minSimilarity) {
          similarities.push({
            tweet1: embeddings[i].tweet,
            tweet2: embeddings[j].tweet,
            similarity,
            tweet1Id: embeddings[i].tweetId,
            tweet2Id: embeddings[j].tweetId
          });
        }
      }
    }

    similarities.sort((a, b) => b.similarity - a.similarity);
    return similarities.slice(0, limit);
  } catch (error) {
    logger.error('Failed to find similar tweets for user', { error: error.message });
    throw error;
  }
}

/**
 * Find users with similar content based on embeddings
 */
export async function findSimilarUsers(userId, minSimilarity = 0.6, limit = 10) {
  try {
    logger.system('Finding similar users', { userId, minSimilarity });

    // Get user's average embedding
    const userEmbedding = await prisma.userEmbedding.findUnique({
      where: { userId }
    });

    if (!userEmbedding) {
      logger.error('No user embedding found', { userId });
      return [];
    }

    // Get all other user embeddings
    const otherUserEmbeddings = await prisma.userEmbedding.findMany({
      where: {
        userId: { not: userId }
      },
      include: {
        user: true
      }
    });

    // Calculate similarities
    const userVector = bufferToFloat32Array(userEmbedding.vector);
    const similarities = otherUserEmbeddings
      .map(otherEmbed => ({
        user: otherEmbed.user,
        similarity: cosineSimilarity(userVector, bufferToFloat32Array(otherEmbed.vector))
      }))
      .filter(item => item.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    logger.system('Found similar users', {
      totalCompared: otherUserEmbeddings.length,
      aboveThreshold: similarities.length
    });

    return similarities;
  } catch (error) {
    logger.error('Failed to find similar users', { error: error.message });
    throw error;
  }
}

/**
 * Find most similar tweet to a given text
 */
export async function findSimilarToText(textEmbedding, userIds = [], minSimilarity = 0.5, limit = 20) {
  try {
    logger.system('Finding tweets similar to text embedding', {
      userIds: userIds.length,
      minSimilarity
    });

    // Build query
    const whereClause = userIds.length > 0
      ? { tweet: { userId: { in: userIds } } }
      : {};

    const embeddings = await prisma.embedding.findMany({
      where: whereClause,
      include: {
        tweet: {
          include: { user: true }
        }
      }
    });

    // Calculate similarities
    const similarities = embeddings
      .map(embed => ({
        tweet: embed.tweet,
        similarity: cosineSimilarity(textEmbedding, bufferToFloat32Array(embed.vector))
      }))
      .filter(item => item.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    logger.system('Found similar tweets to text', {
      totalCompared: embeddings.length,
      aboveThreshold: similarities.length
    });

    return { results: similarities, totalCompared: embeddings.length };
  } catch (error) {
    logger.error('Failed to find similar tweets to text', { error: error.message });
    throw error;
  }
}

/**
 * Find top tweets by embedding similarity to user's average embedding
 */
export async function findTopTweetsByUserEmbedding(userId, limit = 20) {
  try {
    logger.system('Finding top tweets by user embedding similarity', { userId, limit });

    const userEmbedding = await prisma.userEmbedding.findUnique({
      where: { userId }
    });

    if (!userEmbedding) {
      logger.system('No user embedding found', { userId });
      return [];
    }

    const embeddings = await prisma.embedding.findMany({
      where: {
        tweet: { userId }
      },
      include: {
        tweet: true
      }
    });

    if (embeddings.length === 0) {
      return [];
    }

    // Convert embeddings from Buffer to Float32Array
    const userVector = bufferToFloat32Array(userEmbedding.vector);

    // Calculate similarities with tweet embeddings
    const similarities = embeddings
      .map(embed => ({
        tweet: embed.tweet,
        similarity: cosineSimilarity(userVector, bufferToFloat32Array(embed.vector))
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    logger.system('Found top tweets by similarity', {
      userId,
      totalTweets: embeddings.length,
      returned: similarities.length
    });

    return similarities;
  } catch (error) {
    logger.error('Failed to find top tweets by user embedding', { error: error.message });
    throw error;
  }
}

/**
 * Store similarity results in database (optional persistence)
 */
export async function storeSimilarities(similarities, type = 'tweet') {
  try {
    if (type === 'tweet' && similarities.length > 0) {
      // Store tweet similarities
      const data = similarities.map(sim => ({
        tweet1Id: sim.tweet1Id,
        tweet2Id: sim.tweet2Id,
        similarity: sim.similarity
      }));

      await prisma.tweetSimilarity.createMany({
        data,
        skipDuplicates: true
      });

      logger.system('Stored tweet similarities', { count: data.length });
    }
  } catch (error) {
    logger.error('Failed to store similarities', { error: error.message });
    // Non-critical error, don't throw
  }
}

export default {
  cosineSimilarity,
  bufferToFloat32Array,
  findSimilarTweetsBetweenUsers,
  findSimilarTweetsForUser,
  findSimilarUsers,
  findSimilarToText,
  findTopTweetsByUserEmbedding,
  storeSimilarities
};