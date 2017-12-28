var fs = require('fs');
var google = require('googleapis');
var googleAuth = require('google-auth-library');
var express = require('express')
var https = require('https')
var endMw = require('express-end')
var stream = require('stream');
var app = express()

// If modifying these scopes, delete your previously saved credentials
var SCOPES = ['https://www.googleapis.com/auth/drive'];
var TOKEN_DIR = __dirname + '/.credentials/';
var TOKEN_PATH = TOKEN_DIR + 'googleDriveAPI.json';
var TEMP_DIR = __dirname + '/.temp/'
var CHUNK_SIZE = 20000000

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
        oauth2Client.credentials = token;
        storeToken(token);
      });
      res.send('Autenticato con successo!');
   }
  })

  app.get(/\/.{10,}/, function(req, res){    
    refreshTokenIfNeed(oauth2Client, oauth2Client => {
      var access_token = oauth2Client.credentials.access_token  
      var urlSplitted = req.url.match('^[^?]*')[0].split('/')
      var fileId = urlSplitted[1]
      var action = null
      if(urlSplitted[2])
        action = urlSplitted[2]
      var fileInfo = getInfoFromId(fileId)
      if(fileInfo){
        performRequest(fileInfo.info)
      }else{
        getFileInfo(fileId, access_token, info =>{
          addInfo(fileId, info)
          performRequest(info)
        })
      }
      
      function performRequest(fileInfo){
        if(action == 'download'){
          performRequest_download(req, res, access_token, fileInfo)
        }else{
          performRequest_default(req, res, access_token, fileInfo)
        }
      }
    })
    
  });

  app.listen(8998)
  console.log("Server started.")
}

function performRequest_default(req, res, access_token, fileInfo){
  var fileSize = fileInfo.size
  var fileId = fileInfo.id
  const range = req.headers.range
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-")
    const start = parseInt(parts[0], 10)
    const end = parts[1] 
      ? parseInt(parts[1], 10)
      : fileSize-1
    const chunksize = (end-start)+1
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    }
    res.writeHead(206, head);
    downloadFile(fileId, access_token, start, end,
      res,
      () => {res.end()},
      (richiesta) => {
        res.once('close',  function() {
          if(typeof richiesta.abort === "function")
            richiesta.abort()
          if(typeof richiesta.destroy === "function")
            richiesta.destroy()
        })
      }
    )
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    }
    res.writeHead(200, head)
    downloadFile(fileId, access_token, 0, fileSize-1,
      res,
      () => {res.end()},
      (richiesta) => {
        res.once('close',  function() {
          if(typeof richiesta.abort === "function")
            richiesta.abort()
          if(typeof richiesta.destroy === "function")
            richiesta.destroy()
        })
      }
    )
  }
}

function performRequest_download(req, res, access_token, fileInfo){
  var fileSize = fileInfo.size
  var fileId = fileInfo.id
  res.writeHead(200)  
  res.write('Start downloading ...\n')
  var lastTime = (new Date).getTime()
  var downloadedSize = 0
  var downloadSize = 0
  var lastChunksSize = 0
  var echoStream = new stream.Writable()
  echoStream._write = function (chunk, encoding, done) {    
    lastChunksSize += chunk.length
    done();
  }
  var startChunk = 0
  if(req.query.p && req.query.p >= 0 && req.query.p <= 100)
    startChunk = Math.floor(((fileSize-1)/CHUNK_SIZE) * req.query.p / 100)
  downloadSize = fileSize - startChunk*CHUNK_SIZE
  var updateUser = setInterval(() => {
    var nowTime = (new Date).getTime()   
    var speedInMByte = ((lastChunksSize*8 / (nowTime - lastTime)) / 1000)
    lastTime = nowTime
    downloadedSize += lastChunksSize
    lastChunksSize = 0
    res.write('Downloading: ' + (downloadedSize/downloadSize * 100).toFixed(3) +'% | ' + speedInMByte.toFixed(3) + ' Mbps\n')
  }, 2000)
  downloadFile(fileId, access_token, startChunk*CHUNK_SIZE, fileSize-1,
    echoStream,
    () => {
      clearInterval(updateUser);
      res.write('File downloaded.\n')
      res.end()
    },
    (richiesta) => {
      res.once('close',  function() {
        clearInterval(updateUser);
        if(typeof richiesta.abort === "function")
          richiesta.abort()
        if(typeof richiesta.destroy === "function")
          richiesta.destroy()
      })
    }
  )
}

function downloadFile(fileId, access_token, start, end, pipe, onEnd, onStart){
  var startChunk = Math.floor(start / CHUNK_SIZE)
  var chunkName = TEMP_DIR + fileId + '@' + startChunk
  if(fs.existsSync(chunkName)){
    console.log('req: ' + start + ' / ' + end + '   offline')
    var relativeStart = (start > startChunk*CHUNK_SIZE) ? start - (startChunk*CHUNK_SIZE) : 0
    var relativeEnd = (end > (startChunk+1)*CHUNK_SIZE ) ? CHUNK_SIZE : end - (startChunk*CHUNK_SIZE)
    let readStream = fs.createReadStream(chunkName, {start: relativeStart, end: relativeEnd})
    onStart(readStream)
    readStream.pipe(pipe, {end:false})
    readStream.on('data', chunk => {
      //onData(chunk)
    })
    readStream.on('end', () => {      
      if (end >= (startChunk+1)*CHUNK_SIZE ){   //Da rivedere
        console.log('->')
        downloadFile(fileId, access_token, (startChunk+1)*CHUNK_SIZE, end, pipe, onEnd, onStart)
      }else{
        onEnd()
      }      
    })
    readStream.on('close', () => {
    })
    readStream.on('error', (err) => {
      console.log(err)
    })
  }else{
    console.log('req: ' + start + ' / ' + end + '   online')
    httpDownloadFile(fileId, access_token, start, end, pipe, onEnd, onStart)
  }
}

function httpDownloadFile(fileId, access_token, start, end, pipe, onEnd, onStart){
  var options = {
    host: 'www.googleapis.com',
    path: '/drive/v3/files/'+fileId+'?alt=media',
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + access_token,
      'Range': 'bytes='+start+'-'+end
    }
  };

  callback = function(response) {
    var arrBuffer = []
    var arrBufferSize = 0
    response.pipe(pipe)
    response.on('data', function (chunk) {
      //onData(chunk)
      //Concat buffer
      //pipe.write(chunk)
      var buffer = Buffer.from(chunk)
      arrBuffer.push(buffer)
      arrBufferSize += buffer.length
      if(arrBufferSize >= CHUNK_SIZE*2){
        arrBuffer = [Buffer.concat(arrBuffer, arrBufferSize)]
        arrBuffer = flushBuffers(arrBuffer, fileId, start)
        arrBufferSize = arrBuffer[0].length
        var offset = (Math.ceil(start / CHUNK_SIZE) * CHUNK_SIZE) - start
        start += CHUNK_SIZE + offset
      }
    })
    response.on('end', function () {
      onEnd()
    })
  }
  
  var req = https.request(options, callback)
  req.on('error', function(err) {
    
  });
  req.end()
  onStart(req)
}

function flushBuffers(arrBuffer, fileId, startByte){
  var dirtyBuffer = Buffer.alloc(CHUNK_SIZE)
  var offset = (Math.ceil(startByte / CHUNK_SIZE) * CHUNK_SIZE) - startByte
  arrBuffer[0].copy(dirtyBuffer, 0, offset, offset + CHUNK_SIZE ) 
  var chunkName = TEMP_DIR + fileId + '@' + Math.floor((offset + startByte) / CHUNK_SIZE)
  try {
    fs.mkdirSync(TEMP_DIR);
  } catch (err) {
    if (err.code != 'EEXIST') {
      throw err;
    }
  }
  fs.writeFile(chunkName, dirtyBuffer, (err) => {
    if (err) throw err;
    console.log('The chunk has been saved!');
  });
  var remainBufferSize = arrBuffer[0].length - CHUNK_SIZE - offset
  var remainBuffer = Buffer.alloc(remainBufferSize)
  if(remainBuffer.length > 0){
    arrBuffer[0].copy(remainBuffer, 0, CHUNK_SIZE + offset, arrBuffer[0].length) 
  }
  return [remainBuffer]
}

function getFileInfo(fileId, access_token, onData){
  var options = {
    host: 'www.googleapis.com',
    path: '/drive/v3/files/'+fileId+'?alt=json&fields=*',
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + access_token
    }
  };

  callback = function(response) {
    var allData = ''
    response.on('data', function (chunk) {
      allData += chunk
    });
    response.on('end', function () {
      var info = JSON.parse(allData)
      if(!info.error)
        onData(info)
      else
        console.log(info.error)
    });
  }

  https.request(options, callback).end();
}

var filesInfo = []

function getInfoFromId(fileId){
  var result = null
  filesInfo.forEach(data =>{
    if(data.id == fileId){
      result = data 
    }
  })
  return result
}

function addInfo(fileId, fileInfo){
  filesInfo.push({id: fileId, info: fileInfo})
}

/*
function downloadFile(fileId, access_token, startReq){
  var fileChunkStatus = chunkStatus(fileId)
  
  for(var i=0; i < fileChunkStatus.length; i++){
    if(fileChunkStatus[i].start){
      
    }
  }
  
  downloadChunk(fileId, access_token, 0, 100000, downloadFile(fileId, access_token, 100001))
}

function downloadChunk(fileId, access_token, start){
  var fileName = TEMP_DIR + fileId
  
      try {
        fs.mkdirSync(TEMP_DIR);
      } catch (err) {
        if (err.code != 'EEXIST') {
          throw err;
        }
      }
  
      var options = {
        host: 'www.googleapis.com',
        path: '/drive/v3/files/'+fileId+'?alt=media',
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + access_token,
          'Range': 'bytes='+start+'-'
        }
      };
  
      callback = function(response) {
        response.on('data', function (chunk) {
          //fs.appendFileSync(fileName, chunk);
          var fileDescriptor = fs.openSync(fileName, 'a+')
          fs.writeSync(fileDescriptor, chunk, start, 5000000000);
        });
        response.on('end', function () {
        });
      }
  
      https.request(options, callback).end();
}


/*
function chunkStatus(fileId){
  var resultObj = []
  fs.readdirSync(TEMP_DIR).forEach(file => {
    var fileInfo = file.split('@')
    if(fileInfo[0] == fileId){
      var start = fileInfo[1]
      var size = fs.statSync(TEMP_DIR+file).size
      resultObj.push({
        start: start,
        end: start + size
      })
    }
  })
  resultObj.sort((a,b) => {
    return a.start - b.start
  })
  return resultObj
}
*/