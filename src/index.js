const moment = require('moment')
const {
  log,
  BaseKonnector,
  saveBills,
  requestFactory
} = require('cozy-konnector-libs')

let rq = requestFactory({
  cheerio: true,
  json: false,
  // debug: true,
  jar: true
})

module.exports = new BaseKonnector(function fetch(fields) {
  return logIn(fields)
    .then(parsePage)
    .then(entries =>
      saveBills(entries, fields.folderPath, {
        timeout: Date.now() + 60 * 1000,
        identifiers: ['free telecom', 'free hautdebit']
      })
    )
})

// Procedure to login to Free website.
function logIn(fields) {
  const loginUrl = 'https://subscribe.free.fr/login/login.pl'
  const billUrl = 'https://adsl.free.fr/liste-factures.pl'

  const form = {
    pass: fields.password,
    login: fields.login
  }

  const options = {
    url: loginUrl,
    method: 'POST',
    form,
    resolveWithFullResponse: true,
    followAllRedirects: false,
    simple: false
  }

  return rq(options).then(res => {
    const isNoLocation = !res.headers.location
    const isNot302 = res.statusCode !== 302
    const isError =
      res.headers.location && res.headers.location.indexOf('error') !== -1
    if (isNoLocation || isNot302 || isError) {
      log('info', 'Authentification error')
      throw new Error('LOGIN_FAILED')
    }

    const parameters = res.headers.location.split('?')[1]
    const url = `${billUrl}?${parameters}`
    return rq(url).catch(err => {
      console.log(err, 'authentication error details')
      throw new Error('LOGIN_FAILED')
    })
  })
}

// Parse the fetched page to extract bill data.
function parsePage($) {
  const bills = []

  $('.pane li').each(function() {
    let amount = $(this)
      .find('.last')
      .text()
    amount = amount.replace(' Euros', '').replace('&euro;', '')
    amount = amount.replace(',', '.').trim()
    amount = parseFloat(amount)

    let pdfUrl = $(this)
      .find('a')
      .attr('href')
    pdfUrl = `https://adsl.free.fr/${pdfUrl}`

    let month = pdfUrl.split('&')[2].split('=')[1]
    let date = moment(month, 'YYYYMM')

    let bill = {
      amount,
      date: date.toDate(),
      vendor: 'Free'
    }

    if (date.year() > 2011) {
      bill.fileurl = pdfUrl
      bill.filename = getFileName(date)
    }
    bills.push(bill)
  })

  return bills
}

function getFileName(date) {
  return `${date.format('YYYYMM')}_free.pdf`
}
