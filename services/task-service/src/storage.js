const crypto = require('node:crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);

const safeName = (n) => String(n).replace(/[^A-Za-z0-9._-]/g, '_').slice(-100);
const buildKey = (org, taskId, fileName) => `org/${org}/task/${taskId}/${crypto.randomUUID()}-${safeName(fileName)}`;
// A key must belong to the caller's org and task, otherwise someone could presign another tenant's object.
const keyBelongs = (key, org, taskId) => key.startsWith(`org/${org}/task/${taskId}/`);

// MinIO (S3-compatible): same SDK, custom endpoint, path-style. Presigning uses the PUBLIC endpoint
// (what the browser can reach); HEAD checks use the internal one.
function createStorage({ endpoint, publicEndpoint, bucket, accessKeyId, secretAccessKey, region = 'us-east-1' }) {
  const mk = (ep) => new S3Client({ region, endpoint: ep, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
  const internal = mk(endpoint); const signer = mk(publicEndpoint || endpoint);
  return {
    presignPut: (key, contentType) => getSignedUrl(signer, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn: 300 }),
    presignGet: (key, fileName) => getSignedUrl(signer, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: `attachment; filename="${safeName(fileName)}"` }), { expiresIn: 300 }),
    head: async (key) => { const r = await internal.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); return { size: r.ContentLength }; },
  };
}
module.exports = { createStorage, buildKey, keyBelongs, MAX_BYTES, ALLOWED };
