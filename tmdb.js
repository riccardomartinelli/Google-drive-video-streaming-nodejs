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
    var header = {
       Connection: "keep-alive"
    }
    url.searchParams.set('api_key', API_KEY)
    url.searchParams.set('language', language)
    url.searchParams.set('query', videoList[i].query)
    if(videoList[i].year)
        url.searchParams.set('year', videoList[i].year)
    const req = https.request({hostname: url.hostname, path: url.pathname + url.search, headers: header}, (res) => {
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

function titleFormatter(value){
    value = value.replace(/\..*/, "")
    value = value.replace(/\(.+\)/, "")
    
    value = value.replace(/-/, " ")
    return value
}

function titleGetYear(value){
    var yearMatch = value.match(/\((.+)\)/)
    var year = null
    if(yearMatch){
      year = yearMatch[1]
    }
    return year
}

function titleGetEpisodeSeason(value){

    var regEx = value.match(/(.+)(([Ss]([0-9]+)[Ee]([0-9]+))|([Ee]([0-9]+)[Se]([0-9]+))|(([0-9]+)[Xx]([0-9]+)))(.*)/)
    if(regEx){
        var result = {}
        if(regEx[1]){
            var title = regEx[1]
            title = title.replace(/-/, ' ')
            title = title.replace(/\./, ' ')
            result.title = title
        }
        if(regEx[2]){
            if(regEx[3]){
                var ep = parseInt(regEx[5])
                var se = parseInt(regEx[4])
                result.episode = ep
                result.season = se
            }
            if(regEx[6]){
                var ep = parseInt(regEx[7])
                var se = parseInt(regEx[8])
                result.episode = ep
                result.season = se
            }
            if(regEx[9]){
                var ep = parseInt(regEx[11])
                var se = parseInt(regEx[10])
                result.episode = ep
                result.season = se
            }
        }
        return result
    }

    return null

    /*
    var seEp = value.match(/[Ss]([0-9]+)[Ee]([0-9]+)/)
    if(seEp){
        var ep = parseInt(seEp[2])
        var se = parseInt(seEp[1])
        return {episode: ep, season: se}
    }

    var epSe = value.match(/[Ee]([0-9]+)[Se]([0-9]+)/)
    if(epSe){
        var ep = parseInt(epSe[1])
        var se = parseInt(epSe[2])
        return {episode: ep, season: se}
    }

    var seXep = value.match(/([0-9]+)[Xx]([0-9]+)/)
    if(seXep){
        var ep = parseInt(seXep[2])
        var se = parseInt(seXep[1])
        return {episode: ep, season: se}
    } */
}


module.exports = {
    getMovieInfo: getMovieInfo,
    getTvShowInfo: getTvShowInfo, 
    titleFormatter: titleFormatter, 
    titleGetYear: titleGetYear, 
    titleGetEpisodeSeason: titleGetEpisodeSeason}