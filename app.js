var fs = require('fs');
var google = require('googleapis');
var googleAuth = require('google-auth-library');
var express = require('express')
var server = require('./server')
var app = express()

// If modifying these scopes, delete your previously saved credentials
var SCOPES = ['https://www.googleapis.com/auth/drive'];
var TOKEN_DIR = __dirname + '/.credentials/';
var TOKEN_PATH = TOKEN_DIR + 'googleDriveAPI.json';
var PORT = 8998;

// Load client secrets from a local file.
fs.readFile('client_secret.json', function processClientSecrets(err, content) {
  if (err) {
    console.log('Error loading client secret file: ' + err);
    return;
  }
  // Authorize a client with the loaded credentials, then call the
  // Drive API.
  authorize(JSON.parse(content), startLocalServer);
});

function authorize(credentials, callback) {
  var clientSecret = credentials.web.client_secret;
  var clientId = credentials.web.client_id;
  var redirectUrl = credentials.web.redirect_uris[0];
  var auth = new googleAuth();
  var oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);
  
  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, function(err, token) {
    if (err) {
      getNewToken(oauth2Client, callback);
    } else {
      oauth2Client.credentials = JSON.parse(token);
      refreshTokenIfNeed(oauth2Client, callback)
    }
  });
}

function getNewToken(oauth2Client, callback) {
  var authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES
  });
  console.log('Authorize this app by visiting this url: ');
  console.log(authUrl)
  callback(oauth2Client)
}

function refreshTokenIfNeed(oauth2Client, callback){
  var timeNow = (new Date).getTime()
  if(oauth2Client.credentials.expiry_date > timeNow)
    callback(oauth2Client)
  else
    refreshToken(oauth2Client, callback)
}

function refreshToken(oauth2Client, callback) {
  oauth2Client.refreshAccessToken(function(err, token) {
    if (err) {
      console.log('Error while trying to refresh access token', err);
      return;
    }
    oauth2Client.credentials = token;
    storeToken(token);
    callback(oauth2Client)
  })
}

function storeToken(token) {
  try {
    fs.mkdirSync(TOKEN_DIR);
  } catch (err) {
    if (err.code != 'EEXIST') {
      throw err;
    }
  }
  fs.writeFile(TOKEN_PATH, JSON.stringify(token), err => {
    if(err) throw err
  });
}

function startLocalServer(oauth2Client){
  app.get(/\/code/, function (req, res){
    if(req.query.code){
      oauth2Client.getToken(req.query.code, function(err, token) {
        if (err) {
          console.log('Error while trying to retrieve access token', err);
          return;
        }
        if(!token.refresh_token){
          console.log('No refresh token found.');
          return;
        }
        oauth2Client.credentials = token;
        storeToken(token);
      });
      res.send('Successfully authenticated!');
   }
  })

  server.start(callback => {
    refreshTokenIfNeed(oauth2Client, oauth2Client => {
      var access_token = oauth2Client.credentials.access_token  
      callback(access_token)
    })
  })
  app.listen(PORT)
  console.log("GDrive started at port: " + PORT)
}


function listFiles(auth, folderId) {
  var service = google.drive('v3');
  service.files.list({
    auth: auth,
    pageSize: 1000,
    q: "'" + folderId + "' in parents",
    fields: "nextPageToken, files(id, name, parents)"
  }, function(err, response) {
    if (err) {
      console.log('The API returned an error: ' + err);
      return;
    }
    var files = response.files;
    if (files.length == 0) {
      console.log('No files found.');
    } else {
      console.log('Files:');
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        console.log('%s (%s) (%s)', file.name, file.id, file.parents);
      }
    }
  });
}