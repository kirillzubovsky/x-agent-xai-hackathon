import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
dotenv.config();

const API_KEY = process.env.X_COM_API_KEY;
const API_SECRET = process.env.X_COM_API_SECRET;
const ACCESS_TOKEN = process.env.X_COM_ACCESS_TOKEN;
const ACCESS_TOKEN_SECRET = process.env.X_COM_ACCESS_TOKEN_SECRET;

function oauthHeader(method, url, params) {
  const op = {
    oauth_consumer_key: API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: ACCESS_TOKEN,
    oauth_version: '1.0',
  };
  const all = { ...op, ...params };
  const ps = Object.keys(all).sort().map(k => encodeURIComponent(k) + '=' + encodeURIComponent(all[k])).join('&');
  const base = [method.toUpperCase(), encodeURIComponent(url), encodeURIComponent(ps)].join('&');
  const key = encodeURIComponent(API_SECRET) + '&' + encodeURIComponent(ACCESS_TOKEN_SECRET);
  op.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64');
  return 'OAuth ' + Object.keys(op).sort().map(k => encodeURIComponent(k) + '="' + encodeURIComponent(op[k]) + '"').join(', ');
}

async function getLikingUsers(tweetId) {
  const url = 'https://api.x.com/2/tweets/' + tweetId + '/liking_users';
  const params = { 'user.fields': 'id,username,name,public_metrics,profile_image_url' };
  const allUsers = [];
  let nextToken = null;

  do {
    const qp = { ...params };
    if (nextToken) qp.pagination_token = nextToken;

    const header = oauthHeader('GET', url, qp);
    const qs = Object.entries(qp).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');

    const res = await fetch(url + '?' + qs, { headers: { Authorization: header } });

    if (res.status === 429) {
      const resetHeader = res.headers.get('x-rate-limit-reset');
      let waitMs = 15 * 60 * 1000; // default 15 min
      if (resetHeader) {
        waitMs = Math.max(0, parseInt(resetHeader) * 1000 - Date.now()) + 5000; // 5s buffer
      }
      const waitMin = Math.ceil(waitMs / 60000);
      console.log(`  [RATE LIMIT] Waiting ${waitMin} minutes for reset...`);
      await new Promise(r => setTimeout(r, waitMs));
      // Retry this same request
      continue;
    }

    if (!res.ok) {
      console.error(`  [ERROR] Tweet ${tweetId}: ${res.status}`);
      break;
    }

    const data = await res.json();
    if (data.data) allUsers.push(...data.data);
    nextToken = data.meta?.next_token || null;
    if (nextToken) await new Promise(r => setTimeout(r, 300));
  } while (nextToken);

  return allUsers;
}

async function main() {
  const prisma = new PrismaClient();
  const user = await prisma.user.findFirst({ where: { twitterUserId: '17541787' } });

  const tweets = await prisma.tweet.findMany({
    where: { userId: user.id, isReply: false },
    orderBy: { createdAt: 'desc' },
    take: 1000,
    select: { id: true, metricsJson: true, content: true, createdAt: true }
  });

  const withLikes = tweets
    .filter(t => (JSON.parse(t.metricsJson || '{}').like_count || 0) > 0)
    .slice(0, 500);

  console.log(`\nScanning ${withLikes.length} tweets for liking users...`);
  console.log(`Rate limit: 75 requests/15min — will auto-pause on 429\n`);

  const likerCounts = {};
  let processed = 0;
  const startTime = Date.now();

  for (const tweet of withLikes) {
    const likers = await getLikingUsers(tweet.id);
    for (const u of likers) {
      const key = u.username;
      if (!likerCounts[key]) {
        likerCounts[key] = { count: 0, name: u.name, followers: u.public_metrics?.followers_count || 0 };
      }
      likerCounts[key].count++;
    }
    processed++;
    if (processed % 25 === 0) {
      const elapsed = Math.round((Date.now() - startTime) / 60000);
      console.log(`  [PROGRESS] ${processed}/${withLikes.length} tweets processed (${elapsed}min elapsed, ${Object.keys(likerCounts).length} unique likers so far)`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // Sort by count descending
  const sorted = Object.entries(likerCounts)
    .map(([username, d]) => ({ username, ...d }))
    .sort((a, b) => b.count - a.count);

  const elapsed = Math.round((Date.now() - startTime) / 60000);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  WHO LIKES @kirillzubovsky THE MOST`);
  console.log(`  Scanned: ${withLikes.length} tweets | Unique likers: ${sorted.length} | Time: ${elapsed}min`);
  console.log(`${'='.repeat(70)}\n`);

  const maxBar = 40;
  const maxCount = sorted[0]?.count || 1;

  for (const u of sorted.slice(0, 60)) {
    const bar = '\u2588'.repeat(Math.max(1, Math.round((u.count / maxCount) * maxBar)));
    const handle = ('@' + u.username).padEnd(24);
    const cnt = String(u.count).padStart(4);
    const fol = u.followers >= 1000 ? (u.followers / 1000).toFixed(1) + 'k' : String(u.followers);
    console.log(`${handle}${cnt} ${bar}  (${u.name}, ${fol} followers)`);
  }

  if (sorted.length > 60) {
    console.log(`\n  ... and ${sorted.length - 60} more unique likers`);
  }

  // Also print some stats
  const totalLikes = sorted.reduce((s, u) => s + u.count, 0);
  const top10likes = sorted.slice(0, 10).reduce((s, u) => s + u.count, 0);
  console.log(`\n--- Stats ---`);
  console.log(`Total likes collected: ${totalLikes}`);
  console.log(`Top 10 account for: ${top10likes} likes (${Math.round(top10likes / totalLikes * 100)}% of all)`);
  console.log(`Average likes per liker: ${(totalLikes / sorted.length).toFixed(1)}`);
  console.log(`One-time likers: ${sorted.filter(u => u.count === 1).length} (${Math.round(sorted.filter(u => u.count === 1).length / sorted.length * 100)}%)`);

  // Save results to JSON
  const fs = await import('fs');
  const outDir = new URL('../data/', import.meta.url).pathname;
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const date = new Date().toISOString().split('T')[0];
  const outPath = `${outDir}liker-histogram-${date}.json`;
  const output = {
    generated: date,
    tweetsScanned: withLikes.length,
    uniqueLikers: sorted.length,
    totalLikes: totalLikes,
    likers: sorted,
    stats: {
      top10LikeShare: Math.round(top10likes / totalLikes * 100) + '%',
      avgLikesPerLiker: parseFloat((totalLikes / sorted.length).toFixed(1)),
      oneTimeLikers: sorted.filter(u => u.count === 1).length,
      oneTimeLikerPercent: Math.round(sorted.filter(u => u.count === 1).length / sorted.length * 100) + '%',
    }
  };
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${outPath}`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
