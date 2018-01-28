var https = require('https')
const { URL, URLSearchParams } = require('url')

var url_tmdb_movie_search = 'https://api.themoviedb.org/3/search/movie?'
var url_tmdb_tvshow_search = 'https://api.themoviedb.org/3/search/tv?'
var url_img_tmdb = 'https://image.tmdb.org/t/p/w500'
var API_KEY = 'cbc07b147fe94d8f4048efeb77a22b2d'
var language = 'it-IT'

function getTvShowInfo(tvShowList, callback){
    search_rec(url_tmdb_tvshow_search, tvShowList, 0, callback)
}

function getMovieInfo(movieList, callback){
    search_rec(url_tmdb_movie_search, movieList, 0, callback)
}

function search_rec(searchUrl, videoList, i, callback){
    console.log("%s of %s", i+1, videoList.length)
    var url = new URL(searchUrl);
    url.searchParams.set('api_key', API_KEY)
    url.searchParams.set('language', language)
    url.searchParams.set('query', videoList[i].query)
    if(videoList[i].year)
        url.searchParams.set('year', videoList[i].year)
    const req = https.request(url, (res) => {
        var body = ''
        res.on('data', function (chunk) {
            body += chunk
        })
        res.on('end', () =>{
            var bodyParsed = JSON.parse(body)
            if(bodyParsed.results[0]){
                var info = bodyParsed.results[0]
                videoList[i].info = info
            }     
            i++       
            if(i < videoList.length){                
                search_rec(searchUrl, videoList, i, callback)
            }else{
                callback(videoList)
            }   
        })   
        res.on('error', (error) =>{
            console.log(error)
        })   
    })
    req.end()
}

function movieNameFormatter(value){
    value = value.replace(/\..*/, "")
    value = value.replace(/\(.+\)/, "")
    
    value = value.replace(/-/, " ")
    return value
}

function movieNameGetYear(value){
    var yearMatch = value.match(/\(.+\)/)
    var year = null
    if(yearMatch){
      value = value.replace(/\(.+\)/, "")
      year = (yearMatch[0]).substring(1, yearMatch[0].length-1)
    }
    return year
}

module.exports = {getMovieInfo: getMovieInfo, getTvShowInfo: getTvShowInfo, movieNameFormatter: movieNameFormatter, movieNameGetYear: movieNameGetYear}