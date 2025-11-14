const fs = require('fs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({ region: process.env.AWS_REGION });

async function uploadToS3(localPath, key) {
  const Body = fs.createReadStream(localPath);
  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body,
    ACL: 'private',
    ContentType: key.endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4'
  }));
  return `s3://${process.env.S3_BUCKET}/${key}`;
}

module.exports = { uploadToS3 };
