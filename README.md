# Google-drive-video-streaming-nodejs
This is a small script in nodejs that allow you to watch a video stored into your Google drive directly into your video player.

### Install
You need only to install all the dependencies typing this command:
```bash
npm install
```


### Usage
Just type this command to startup the script:
```bash
node ./app.js
```
Now that the server is started you can start watching your video or download it.

#### Streaming
Paste this link into your player to start watching the video in streaming
```bash
http://127.0.0.1:8998/<google-drive-video-id>
```
#### Download
To download it, type this url into a new broser tab
```bash
http://127.0.0.1:8998/<google-drive-video-id>/download
```
if you want you can specify the parameter p, that indicate in percentage what portion of video will be skipped.
For example to start downloading the video from half you should use this link

```bash
http://127.0.0.1:8998/<google-drive-video-id>/download?p=50
```
You can even use the parameter c, that indicate from what chunk the download must be started.
To stop the downloading process use this url:
```bash
http://127.0.0.1:8998/<google-drive-video-id>/download_stop
```
