#!/usr/bin/env node
/**
 * One-time script to get OAuth 1.0a Access Token and Secret via PIN-based flow.
 *
 * Usage: node scripts/get-oauth-tokens.js
 *
 * 1. It will print a URL — open it in your browser
 * 2. Authorize the app on X
 * 3. X gives you a PIN code
 * 4. Paste the PIN back here
 * 5. It prints your Access Token and Access Token Secret
 * 6. Add them to your .env file
 */

import crypto from 'crypto';
import readline from 'readline';

// Load env
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
dotenv.config();

const API_KEY = process.env.X_COM_API_KEY;
const API_SECRET = process.env.X_COM_API_SECRET;

if (!API_KEY || !API_SECRET) {
  console.error('Missing X_COM_API_KEY or X_COM_API_SECRET in .env');
  process.exit(1);
}

function generateOAuthHeader(method, url, params, tokenSecret = '') {
  const oauthParams = {
    oauth_consumer_key: API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: '1.0',
    ...params,
  };

  const allParams = { ...oauthParams };
  const paramString = Object.keys(allParams)
    .sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');

  const signatureBase = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(paramString),
  ].join('&');

  const signingKey = `${encodeURIComponent(API_SECRET)}&${encodeURIComponent(tokenSecret)}`;

  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(signatureBase)
    .digest('base64');

  oauthParams.oauth_signature = signature;

  return 'OAuth ' + Object.keys(oauthParams)
    .sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(', ');
}

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('\n=== X OAuth 1.0a PIN-Based Token Generator ===\n');

  // Step 1: Get request token
  console.log('Step 1: Requesting temporary token...');
  const requestTokenUrl = 'https://api.x.com/oauth/request_token';
  const header1 = generateOAuthHeader('POST', requestTokenUrl, {
    oauth_callback: 'oob',  // PIN-based (out-of-band)
  });

  const res1 = await fetch(requestTokenUrl, {
    method: 'POST',
    headers: { Authorization: header1 },
  });

  if (!res1.ok) {
    const text = await res1.text();
    console.error(`Failed to get request token: ${res1.status} ${text}`);
    console.error('\nMake sure your app has OAuth 1.0a enabled:');
    console.error('  Developer Portal > Your App > Settings > User authentication settings > Edit');
    console.error('  Enable OAuth 1.0a, set App permissions to "Read", set callback to any URL');
    process.exit(1);
  }

  const body1 = await res1.text();
  const params1 = new URLSearchParams(body1);
  const oauthToken = params1.get('oauth_token');
  const oauthTokenSecret = params1.get('oauth_token_secret');

  // Step 2: User authorizes
  const authorizeUrl = `https://api.x.com/oauth/authorize?oauth_token=${oauthToken}`;
  console.log(`\nStep 2: Open this URL in your browser and authorize the app:\n`);
  console.log(`  ${authorizeUrl}\n`);

  const pin = await ask('Step 3: Enter the PIN from X: ');

  // Step 3: Exchange for access token
  console.log('\nStep 4: Exchanging PIN for access token...');
  const accessTokenUrl = 'https://api.x.com/oauth/access_token';
  const header3 = generateOAuthHeader('POST', accessTokenUrl, {
    oauth_token: oauthToken,
    oauth_verifier: pin,
  }, oauthTokenSecret);

  const res3 = await fetch(accessTokenUrl, {
    method: 'POST',
    headers: { Authorization: header3 },
  });

  if (!res3.ok) {
    const text = await res3.text();
    console.error(`Failed to get access token: ${res3.status} ${text}`);
    process.exit(1);
  }

  const body3 = await res3.text();
  const params3 = new URLSearchParams(body3);
  const accessToken = params3.get('oauth_token');
  const accessTokenSecret = params3.get('oauth_token_secret');
  const screenName = params3.get('screen_name');
  const userId = params3.get('user_id');

  console.log(`\nSuccess! Authenticated as @${screenName} (${userId})\n`);
  console.log('Add these to your .env file:\n');
  console.log(`X_COM_ACCESS_TOKEN=${accessToken}`);
  console.log(`X_COM_ACCESS_TOKEN_SECRET=${accessTokenSecret}`);
  console.log('');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
