var https = require('https')
const { URL, URLSearchParams } = require('url')

var url_tmdb = 'https://api.themoviedb.org/3/search/movie?'
var API_KEY = 'cbc07b147fe94d8f4048efeb77a22b2d'
var language = 'it-IT'

function movieSearch(movieList){
    movieSearch_rec(movieList, 0)
}

function movieSearch_rec(movieList, i){
    var url = new URL(url_tmdb);
    url.searchParams.set('api_key', API_KEY)
    url.searchParams.set('language', language)
    url.searchParams.set('query', movieList[i].name)

    const req = https.request(url, (res) => {
        var body = ''
        res.on('data', function (chunk) {
            body += chunk
        })
        res.on('end', () =>{
            var bodyParsed = JSON.parse(body)
            if(bodyParsed.results[0]){
                var info = bodyParsed.results[0]
                movieList[i].info = info
                console.log(info)
            }     
            i++       
            if(i < movieList.length){                
                movieSearch_rec(movieList, i)
            }   
        })   
        res.on('error', (error) =>{
            console.log(error)
        })   
    })
    req.end()
}

movieSearch([{name: '2001 odissea'}, {name: 'guida galattica'}])