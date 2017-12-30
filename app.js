var fs = require('fs');
var google = require('googleapis');
var googleAuth = require('google-auth-library');
var express = require('express')
var https = require('https')
var endMw = require('express-end')
var stream = require('stream');
const getDuration = require('get-video-duration');
var app = express()

// If modifying these scopes, delete your previously saved credentials
var SCOPES = ['https://www.googleapis.com/auth/drive'];
var TOKEN_DIR = __dirname + '/.credentials/';
var TOKEN_PATH = TOKEN_DIR + 'googleDriveAPI.json';
var TEMP_DIR = __dirname + '/.temp/'
var CHUNK_SIZE = 20000000
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

  app.get(/\/.{15,}/, function(req, res){    
    refreshTokenIfNeed(oauth2Client, oauth2Client => {
      var access_token = oauth2Client.credentials.access_token  
      var urlSplitted = req.url.match('^[^?]*')[0].split('/')
      var fileId = urlSplitted[1]
      var action = null
      if(urlSplitted[2])
        action = urlSplitted[2]
      var fileInfo = getInfoFromId(fileId)
      if(fileInfo){
        performRequest(fileInfo)
      }else{
        getFileInfo(fileId, access_token, info =>{
          addInfo(fileId, info)
          var fileInfo = getInfoFromId(fileId)
          performRequest(fileInfo)
        })
      }
      
      function performRequest(fileInfo){
        var skipDefault = false
        if(action == 'download'){
          performRequest_download_start(req, res, access_token, fileInfo)
          skipDefault = true
        }
        if(action == 'download_stop'){
          performRequest_download_stop(req, res, access_token, fileInfo)
          skipDefault = true
        }

        if(!skipDefault){
          performRequest_default(req, res, access_token, fileInfo)
        }
      }
    })
    
  });

  app.listen(PORT)
  console.log("Server started at port: " + PORT)
}

function performRequest_default(req, res, access_token, fileInfo){
  var fileSize = fileInfo.info.size
  var fileMime = fileInfo.info.mimeType
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
      //'Content-Type': 'video/mp4',
      'Content-Type': fileMime
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
      'Content-Type': fileMime,
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

function performRequest_download_start(req, res, access_token, fileInfo){
  var fileSize = fileInfo.info.size
  var fileId = fileInfo.id
  var status = getDownloadStatus(fileId)
  if(!status){
    status = addDownloadStatus(fileId)
    var lastTime = (new Date).getTime()
    var downloadedSize = 0
    var downloadSize = 0 
    var startChunk = 0
    if(req.query.p && req.query.p >= 0 && req.query.p <= 100)
      startChunk = Math.floor(((fileSize)/CHUNK_SIZE) * req.query.p / 100)
    if(req.query.c && req.query.c >= 0 && req.query.c <= Math.floor((fileSize)/CHUNK_SIZE))
      startChunk = req.query.c
    downloadSize = fileSize - startChunk*CHUNK_SIZE
  
    var videoDuration = null
    fileInfo.getVideoLength.then((data) => {
      console.log(data)
      videoDuration = data
    })
    .catch((error) => {
      console.log(error)
    })
  
    var echoStream = new stream.Writable()
    var chunkSizeSinceLast = 0
    echoStream._write = function (chunk, encoding, done) {    
      chunkSizeSinceLast += chunk.length
      var nowTime = (new Date).getTime()        
      
      //update status    
      if(nowTime - lastTime > 2000){
        var speedInMBit = ((chunkSizeSinceLast*8 / (nowTime - lastTime)) / 1000)
        var speedInByte = (speedInMBit/8) * 1000000
        downloadedSize += chunkSizeSinceLast
        status.status = (downloadedSize/downloadSize * 100).toFixed(3)
        status.speedMbit = speedInMBit.toFixed(3)
        status.speedByte = speedInByte
        if(videoDuration){
          var timeLeftBeforeStreaming = Math.max(Math.round((downloadSize / speedInByte) - (videoDuration*downloadSize/fileSize)) , 0)
          status.timeLeftBeforeStreaming = timeLeftBeforeStreaming
        }
        lastTime = nowTime
        chunkSizeSinceLast = 0
      }
      
      done();
    }
  
    downloadFile(fileId, access_token, startChunk*CHUNK_SIZE, fileSize-1,
      echoStream,
      () => {
        removeDownloadStatus(fileId)
      },
      (richiesta) => {
        status.onClose = () =>{
          if(typeof richiesta.abort === "function")
            richiesta.abort()
          if(typeof richiesta.destroy === "function")
            richiesta.destroy()
          removeDownloadStatus(fileId)
        }
      }
    )
  }
  res.writeHead(200)  
  res.write(JSON.stringify(status))
  res.end()
}

function performRequest_download_stop(req, res, access_token, fileInfo){
  var fileId = fileInfo.id
  var status = getDownloadStatus(fileId)
  if(status){
    status.onClose()
  }
  res.writeHead(200)  
  res.end()
}

function downloadFile(fileId, access_token, start, end, pipe, onEnd, onStart){
  var startChunk = Math.floor(start / CHUNK_SIZE)
  var chunkName = TEMP_DIR + fileId + '@' + startChunk
  if(fs.existsSync(chunkName)){
    console.log('req: ' + start + ' / ' + end + '   offline')
    var relativeStart = (start > startChunk*CHUNK_SIZE) ? start - (startChunk*CHUNK_SIZE) : 0
    var relativeEnd = (end > (startChunk+1)*CHUNK_SIZE ) ? CHUNK_SIZE : end - (startChunk*CHUNK_SIZE)
    let readStream = fs.createReadStream(chunkName, {start: relativeStart, end: relativeEnd})    
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
    onStart(readStream)
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
    response.pipe(pipe, {end:false})
    response.on('data', function (chunk) {
      var buffer = Buffer.from(chunk)
      arrBuffer.push(buffer)
      arrBufferSize += buffer.length
      var nextChunk = Math.floor((start + arrBufferSize) / CHUNK_SIZE)
      var chunkName = TEMP_DIR + fileId + '@' + nextChunk
      if(fs.existsSync(chunkName) && start + arrBufferSize < end){
        req.abort()
        downloadFile(fileId, access_token, start + arrBufferSize, end, pipe, onEnd, onStart)
      }else{
        if(arrBufferSize >= CHUNK_SIZE*2){
          arrBuffer = [Buffer.concat(arrBuffer, arrBufferSize)]
          arrBuffer = flushBuffers(arrBuffer, fileId, start)
          arrBufferSize = arrBuffer[0].length
          var offset = (Math.ceil(start / CHUNK_SIZE) * CHUNK_SIZE) - start
          start += CHUNK_SIZE + offset
        }
      }
    })
    response.on('end', function () {
      //Aggiungere il controllo se c'è un errore
      if(!req.aborted){
        onEnd()
      }      
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


//File info
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
  var info = {id: fileId, info: fileInfo}
  info.getVideoLength = new Promise((resolve, reject) => {
    if(!info.videoLength){
      getDuration('http://127.0.0.1:' + PORT + '/' + fileId).then((duration) => {
        info.videoLength = duration
        resolve(duration)
      })
      .catch((error) => {
        console.log(error);
        reject(error)
      })
    }else{
      resolve(info.videoLength)
    }
    
  })

  filesInfo.push(info)
}

//Downloads status
var downloadStatus = []

function getDownloadStatus(fileId){
  var result = null
  downloadStatus.forEach(data =>{
    if(data.id == fileId){
      result = data 
    }
  })
  return result
}

function addDownloadStatus(fileId){
  var status = {id: fileId}
  status.onClose = () => {}
  downloadStatus.push(status)
  return status
}

function removeDownloadStatus(fileId){
  for(var i =0; i < downloadStatus.length; i++){
    if(downloadStatus[i].id == fileId){
      downloadStatus.splice(i, 1)
    }
  }
}
