const AWS = require('aws-sdk');
const fs = require('fs');

const s3 = new AWS.S3();
const resolution = 150;

exports.handler = function(event, context) {
  const srcBucket = event.Records[0].s3.bucket.name;
  const srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));
  const dstBucket = srcBucket + 'resized';
  const dstKey = 'resized-' + srcKey;

  if (srcBucket === dstBucket) {
    console.error('Destination bucket must not match source bucket.');
    return;
  }

  const typeMatch = srcKey.match(/\.([^.]*)$/);
  if (!typeMatch) {
    console.error('Unable to infer image type for key ' + srcKey);
    return;
  }
  const imageType = typeMatch[1];
  console.log('imageType: ' + imageType);
  if (imageType !== 'pdf') {
    console.log('Skipping non-image ' + srcKey);
    return;
  }

  async.waterfall(
    [
      function download(next) {
        console.log('Download start');
        s3.getObject({ Bucket: srcBucket, Key: srcKey }, function(err, data) {
          if (err) {
            console.error('Error getting object from S3: ' + err);
            next(err);
          } else {
            fs.writeFile('/tmp/a.pdf', data.Body, { encoding: null }, function(fserr) {
              if (fserr) {
                console.error('Error writing file to disk: ' + fserr);
                next(fserr);
              } else {
                console.log('File downloaded: ' + data.ContentType);
                next(null, data.ContentType);
              }
            });
          }
        });
      },
      function compress(contentType, next) {
        console.log('Compress start. ContentType: ' + contentType);
        const exec = require('child_process').exec;
        const command = 'gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dNOPAUSE -dQUIET -dBATCH -sOutputFile=/tmp/b.pdf /tmp/a.pdf';
        exec(command, function(error, stdout, stderr) {
          console.log('stdout: ' + stdout);
          console.log('stderr: ' + stderr);
          if (error) {
            console.error('Error compressing PDF: ' + error);
            next(error);
          } else {
            next(null, contentType);
          }
        });
      },
      function upload(contentType, next) {
        console.log('Upload start. ContentType: ' + contentType);
        fs.readFile('/tmp/b.pdf', function(err, data) {
          if (err) {
            console.error('Error reading compressed file: ' + err);
            next(err);
          } else {
            s3.putObject({ Bucket: dstBucket, Key: dstKey, Body: data, ContentType: contentType }, function(err, data) {
              if (err) {
                console.error('Error uploading compressed file to S3: ' + err);
                next(err);
              } else {
                console.log('PDF uploaded');
                next();
              }
            });
          }
        });
      },
    ],
    function(err) {
      if (err) {
        console.error('An error occurred: ' + err);
      }
      context.done();
    }
  );

  console.log('Done');
};