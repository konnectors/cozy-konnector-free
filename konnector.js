const moment = require('moment')
const cheerio = require('cheerio')
const request = require('request')

const {
    log,
    baseKonnector,
    filterExisting,
    linkBankOperation,
    saveDataAndFile,
    models
} = require('cozy-konnector-libs')
const Bill = models.bill

// Konnector
module.exports = baseKonnector.createNew({
  name: 'Free',
  slug: 'free',
  description: 'konnector description free',
  vendorLink: 'https://www.free.fr/',

  category: 'isp',
  color: {
    hex: '#CD1E25',
    css: '#CD1E25'
  },

  dataType: ['bill'],

  models: [Bill],

  fetchOperations: [
    logIn,
    parsePage,
    customFilterExisting,
    customSaveDataAndFile,
    customLinkBankOperations
  ]
})

// Procedure to login to Free website.
function logIn (requiredFields, billInfos, data, next) {
  const loginUrl = 'https://subscribe.free.fr/login/login.pl'
  const billUrl = 'https://adsl.free.fr/liste-factures.pl'

  const form = {
    pass: requiredFields.password,
    login: requiredFields.login
  }

  const options = {
    method: 'POST',
    form,
    jar: true,
    url: loginUrl
  }

  request(options, function (err, res, body) {
    const isNoLocation = !res.headers.location
    const isNot302 = res.statusCode !== 302
    const isError =
      res.headers.location &&
      res.headers.location.indexOf('error') !== -1

    if (err || isNoLocation || isNot302 || isError) {
      log('error', 'Authentification error')
      next('LOGIN_FAILED')
    } else {
      const parameters = res.headers.location.split('?')[1]
      const url = `${billUrl}?${parameters}`
      request.get(url, function (err, res, body) {
        if (err) {
          log('error', err)
          next('LOGIN_FAILED')
        } else {
          data.html = body
          next()
        }
      })
    }
  })
}

// Parse the fetched page to extract bill data.
function parsePage (requiredFields, bills, data, next) {
  bills.fetched = []

  if (!data.html) {
    log('info', 'No new bills to import')
    return next()
  }

  const $ = cheerio.load(data.html)
  $('.pane li').each(function () {
    let amount = $($(this).find('strong').get(1)).html()
    amount = amount.replace(' Euros', '').replace('&euro;', '')
    amount = amount.replace(',', '.').trim()
    amount = parseFloat(amount)

    let pdfUrl = $(this).find('.last a').attr('href')
    pdfUrl = `https://adsl.free.fr/${pdfUrl}`

    let month = pdfUrl.split('&')[2].split('=')[1]
    let date = moment(month, 'YYYYMM')

    let bill = {
      amount,
      date,
      vendor: 'Free'
    }

    if (date.year() > 2011) {
      bill.pdfurl = pdfUrl
    }
    bills.fetched.push(bill)
  })
  next()
}

function customFilterExisting (requiredFields, entries, data, next) {
  filterExisting(null, Bill)(requiredFields, entries, data, next)
}

function customSaveDataAndFile (requiredFields, entries, data, next) {
  saveDataAndFile(null, Bill, 'free', ['facture'])(
        requiredFields,
        entries,
        data,
        next
    )
}

function customLinkBankOperations (requiredFields, entries, data, next) {
  linkBankOperation({
    log,
    model: Bill,
    identifier: ['free telecom', 'free hautdebit'],
    dateDelta: 10,
    amountDelta: 0.1
  })
}
