process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://905252fcdc43c9547807c9a96c891e2e@errors.cozycloud.cc/66'

const moment = require('moment')
const {
  log,
  BaseKonnector,
  requestFactory,
  cozyClient
} = require('cozy-konnector-libs')

let rq = requestFactory({
  cheerio: true,
  json: false,
  // debug: false,
  jar: true
})

// Importing models to get qualification by label
const models = cozyClient.new.models
const { Qualification } = models.document

module.exports = new BaseKonnector(function fetch(fields) {
  return logIn
    .bind(this)(fields)
    .then(parsePage)
    .then(entries =>
      this.saveBills(entries, fields, {
        fileIdAttributes: ['vendorRef'],
        identifiers: ['free telecom', 'free hautdebit']
      })
    )
    .then(renameParentDirectory.bind(this)(fields))
})

// Procedure to login to Free website.
async function logIn(fields) {
  await this.deactivateAutoSuccessfulLogin()
  const loginUrl = 'https://subscribe.free.fr/login/do_login.pl'
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

  const firstres = await rq(options)
  const firstlocation = firstres.caseless.dict.location

  if (!firstlocation) {
    throw new Error('LOGIN_FAILED')
  }

  // Second request to the redirect URL
  const res = await rq({
    url: firstlocation,
    followAllRedirects: true
  })

  // Old fashion node 12 headers call
  // const isNoLocation = !res.headers.location
  const location = firstlocation
  const isNoLocation = !firstlocation
  const isError = firstlocation && firstlocation.indexOf('error') !== -1
  if (isNoLocation) {
    log('info', 'Authentication error: No location header found.')
    throw new Error('LOGIN_FAILED_NO_LOCATION')
  }
  if (isError) {
    log('info', 'Authentication error: Redirection led to an error page.')
    throw new Error('LOGIN_FAILED_ERROR_PAGE')
  }
  // Throw login fail if we are redirected on the webmail
  // That just not a valid account
  if (
    res.statusCode === 302 &&
    location.includes('/accesgratuit/console/console.pl')
  ) {
    log('info', 'Authentification error')
    log('info', 'This account seems a webmail account only')
    throw new Error('LOGIN_FAILED')
  }

  await this.notifySuccessfulLogin()

  const parameters = location.split('?')[1]
  const url = `${billUrl}?${parameters}`

  const rqNoCheerio = requestFactory({
    cheerio: false,
    json: false,
    jar: true,
    resolveWithFullResponse: true,
    simple: false
  })

  return rqNoCheerio(url)
    .then(response => {
      log('debug', `Bill page response status: ${response.statusCode}`)

      if (response.body.includes('Session invalide')) {
        log('info', 'Invalid session')
        throw new Error('INVALID_SESSION')
      }
      return rq(url)
    })
    .catch(err => {
      log('info', 'Error details:')
      log('info', err)
      if (err.message === 'INVALID_SESSION') {
        throw new Error('INVALID_SESSION')
      }
      throw new Error('LOGIN_FAILED')
    })
}

// Parse the fetched page to extract bill data.
function parsePage($) {
  const bills = []

  $('.pane li').each(function () {
    let amount = $(this).find('.last').text()
    amount = amount.replace(' Euros', '').replace('&euro;', '')
    amount = amount.replace(',', '.').trim()
    amount = parseFloat(amount)

    let pdfUrl = $(this).find('a').attr('href')
    pdfUrl = `https://adsl.free.fr/${pdfUrl}`

    let month = pdfUrl.split('&')[2].split('=')[1]
    let date = moment(month, 'YYYYMM')
    let idBill = pdfUrl.split('&')[3].split('=')[1]
    let contractNumber = pdfUrl.split('=')[1].split('&')[0]

    let bill = {
      amount,
      date: date.toDate(),
      vendor: 'Free',
      vendorRef: idBill,
      fileAttributes: {
        metadata: {
          datetime: date.toDate(),
          datetimeLabel: 'issueDate',
          contentAuthor: 'free',
          issueDate: date.toDate(),
          invoiceNumber: idBill,
          contractReference: contractNumber,
          isSubscription: true,
          carbonCopy: true,
          qualification: Qualification.getByLabel('isp_invoice')
        }
      }
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

async function renameParentDirectory(fields) {
  try {
    const client = cozyClient.new
    // Looking for parent directory created by home
    const importDir = await client
      .collection('io.cozy.files')
      .statByPath(fields.folderPath)
    const parentDir = await client
      .collection('io.cozy.files')
      .statById(importDir.data.attributes.dir_id)
    if (parentDir.data.attributes.name == 'Free') {
      // Renaming
      log('info', 'Renaming parent directory to Free Internet')
      await client
        .collection('io.cozy.files')
        .updateAttributes(parentDir.data._id, {
          name: 'Free Internet'
        })
    }
  } catch (e) {
    log('error', 'Failing to rename parent directory, continuing')
    log('error', e.message)
  }
}
