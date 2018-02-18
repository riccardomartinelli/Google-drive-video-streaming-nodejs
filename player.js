var cmd=require('node-cmd');

var PORT = 7007

function open(fileName){
    cmd.run('mpc-hc64.exe ' + fileName + ' /play /fullscreen /webport ' + PORT)
}

function close(){
    cmd.run('taskkill /IM mpc-hc64.exe')
}

module.exports = {open, close}