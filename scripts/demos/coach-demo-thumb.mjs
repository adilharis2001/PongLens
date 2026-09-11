// Copy the existing public-showcase demo match thumbnail, without changing it.
// Requires SERVICE_KEY and the existing R2 credentials; performs GETs only.
import { AwsClient } from 'aws4fetch';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = 'https://pdycinmyfnritemrsfjf.supabase.co';
const response = await fetch(`${base}/rest/v1/matches?id=eq.efff9208-abf2-4a20-a498-18cc5a5130b3&select=thumb_path`, { headers: { apikey: process.env.SERVICE_KEY, Authorization: `Bearer ${process.env.SERVICE_KEY}` } });
assert.ok(response.ok, 'demo match lookup');
const [match] = await response.json();
assert.ok(match.thumb_path.startsWith('r2://ponglens-media/'), 'demo media thumbnail');
const key = match.thumb_path.slice('r2://ponglens-media/'.length);
const client = new AwsClient({ accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY, region: 'auto', service: 's3' });
const image = await client.fetch(`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/ponglens-media/${key.split('/').map(encodeURIComponent).join('/')}`);
assert.ok(image.ok, 'demo thumbnail download');
assert.ok(image.headers.get('content-type')?.startsWith('image/'), 'image response');
await writeFile(new URL('../../public/showcase/coach-demo-thumb.jpg', import.meta.url), Buffer.from(await image.arrayBuffer()));
console.log('Saved demo match thumbnail');
