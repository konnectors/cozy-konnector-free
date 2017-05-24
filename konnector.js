let cozydb = require('cozydb')
let request = require('request')
let moment = require('moment')
let cheerio = require('cheerio')
let fs = require('fs')

let File = require('../models/file')
let fetcher = require('../lib/fetcher')
let filterExisting = require('../lib/filter_existing')
let saveDataAndFile = require('../lib/save_data_and_file')
let linkBankOperation = require('../lib/link_bank_operation')

let localization = require('../lib/localization_manager')

let log = require('printit')({
  prefix: 'Free',
  date: true
})

// Models

let InternetBill = cozydb.getModel('InternetBill', {
  date: Date,
  vendor: String,
  amount: Number,
  fileId: String
})

InternetBill.all = callback => InternetBill.request('byDate', callback)

// Konnector

module.exports = {
  name: 'Free',
  slug: 'free',
  description: 'konnector description free',
  vendorLink: 'https://www.free.fr/',

  category: 'isp',
  color: {
    hex: '#CD1E25',
    css: '#CD1E25'
  },

  fields: {
    login: {
      type: 'text'
    },
    password: {
      type: 'password'
    },
    folderPath: {
      type: 'folder',
      advanced: true
    }
  },

  dataType: ['bill'],

  models: {
    internetbill: InternetBill
  },

  // Define model requests.
  init(callback) {
    let map = doc => emit(doc.date, doc)
    return InternetBill.defineRequest('byDate', map, err => callback(err))
  },

  fetch(requiredFields, callback) {
    log.info('Import started')

    return fetcher
      .new()
      .use(logIn)
      .use(parsePage)
      .use(filterExisting(log, InternetBill))
      .use(saveDataAndFile(log, InternetBill, 'free', ['facture']))
      .use(
        linkBankOperation({
          log,
          model: InternetBill,
          identifier: ['free telecom', 'free hautdebit'],
          dateDelta: 10,
          amountDelta: 0.1
        })
      )
      .args(requiredFields, {}, {})
      .fetch(function(err, fields, entries) {
        log.info('Import finished')

        let notifContent = null
        if (
          __guard__(
            entries != null ? entries.filtered : undefined,
            x => x.length
          ) > 0
        ) {
          let localizationKey = 'notification bills'
          let options = { smart_count: entries.filtered.length }
          notifContent = localization.t(localizationKey, options)
        }

        return callback(err, notifContent)
      })
  }
}

// Procedure to login to Free website.
var logIn = function(requiredFields, billInfos, data, next) {
  let loginUrl = 'https://subscribe.free.fr/login/login.pl'
  let billUrl = 'https://adsl.free.fr/liste-factures.pl'

  let form = {
    pass: requiredFields.password,
    login: requiredFields.login
  }

  let options = {
    method: 'POST',
    form,
    jar: true,
    url: loginUrl
  }

  return request(options, function(err, res, body) {
    let isNoLocation = res.headers.location == null
    let isNot302 = res.statusCode !== 302
    let isError =
      res.headers.location != null &&
      res.headers.location.indexOf('error') !== -1

    if (err || isNoLocation || isNot302 || isError) {
      log.error('Authentification error')
      return next('bad credentials')
    } else {
      let { location } = res.headers
      let parameters = location.split('?')[1]
      let url = `${billUrl}?${parameters}`
      return request.get(url, function(err, res, body) {
        if (err) {
          return next(err)
        } else {
          data.html = body
          return next()
        }
      })
    }
  })
}

// Parse the fetched page to extract bill data.
var parsePage = function(requiredFields, bills, data, next) {
  bills.fetched = []

  if (data.html == null) {
    return next()
  }

  let $ = cheerio.load(data.html)
  $('.pane li').each(function() {
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
    return bills.fetched.push(bill)
  })
  return next()
}

function __guard__(value, transform) {
  return typeof value !== 'undefined' && value !== null
    ? transform(value)
    : undefined
}
