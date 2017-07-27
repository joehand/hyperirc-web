var html = require('choo/html')
var choo = require('choo')
var log = require('choo-log')
var css = require('sheetify')
var wss = require('websocket-stream')
var hypercore = require('hypercore')
var ram = require('random-access-memory')
var pump = require('pump')
var moment = require('moment')
var Autolinker = require('autolinker')
var debounce = require('lodash/debounce')
var logo = require('./elements/logo')

css('tachyons')
css`
  .pulse-circle {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    box-shadow: 0 0 0 rgba(205, 236, 255, 0.6);
    animation: pulse 4s 2s infinite;
  }
  .pulse-circle:hover {
    animation: none;
  }
  @-webkit-keyframes pulse {
    0% {
      -webkit-box-shadow: 0 0 0 0 rgba(205, 236, 255, 1);
    }
    70% {
        -webkit-box-shadow: 0 0 0 10px rgba(205, 236, 255, 0);
    }
    100% {
        -webkit-box-shadow: 0 0 0 0 rgba(205, 236, 255, 0);
    }
  }
  @keyframes pulse {
    0% {
      -moz-box-shadow: 0 0 0 0 rgba(205, 236, 255, 1);
      box-shadow: 0 0 0 0 rgba(205, 236, 255, 1);
    }
    70% {
        -moz-box-shadow: 0 0 0 20px rgba(205, 236, 255, 0);
        box-shadow: 0 0 0 20px rgba(205, 236, 255, 0);
    }
    100% {
        -moz-box-shadow: 0 0 0 0 rgba(205, 236, 255, 0);
        box-shadow: 0 0 0 0 rgba(205, 236, 255, 0);
    }
  }

  .logo {
    height:42px;
  }

  .logo svg {
    width:auto;
    height:42px;
  }

  footer {
    background-color: #293648;
  }
`

var app = choo()
app.use(log())
app.use(connectWs)
app.use(updateTimestamps)
app.route('/', mainView)
app.mount('body')

function mainView (state, emit) {
  var onScrollDebounced = debounce(onScroll, 50)
  var logoEl = html`<div class="logo ma0"></div>`
  logoEl.innerHTML = logo
  var footer = html`
    <footer class="fixed w-100 bottom-0 ph3 pv2 ph4-m ph5-l">
      <nav class="flex justify-between">
        <a class="flex items-center pa1 white link dim" href="http://datproject.org" title="Dat project">
          ${logoEl}
        </a>
        <div class="flex-grow flex items-center">
          <a class="link dim white pa1 f6 f5-ns dib mr3 mr4-ns" href="https://github.com/joehand/hyperirc-web" title="hyperirc-web">source</a>
          <a class="link dim white pa1 f6 f5-ns dib mr3 mr4-ns" href="https://webchat.freenode.net/?channels=dat" title="Join Chat">chat</a>
        </div>
      </nav>
    </footer>
  `

  if (!state.messages.length) {
    return html`
      <body class="avenir">
        ${footer}
        hello
      </body>
    `
  }

  return html`
    <body class="avenir" onscroll=${onScrollDebounced}>
      ${footer}
      <div class="mw-100 mw7-ns center mb6">
        <article class="pa3 ph5-ns">
          <h3 class="f6 ttu tracked mt0">Dat project chat log. Join on <a href="https://webchat.freenode.net/?channels=dat">freenode</a> or <a href="http://gitter.im/datproject/discussions">Gitter.im</a>.</h3>
          <p class="measure f5 lh-copy">
            <span>Logging ${state.channel} via <a href="https://github.com/mafintosh/hyperirc">hyperirc</a></span>
          </p>
        </article>
        <div class="near-black bg-washed-blue">
          <div class="flex justify-between pa1 ph5-ns bb b--black-10 bg-light-gray br3 br--top">
            <div class="flex items-center f6 ttu tracked">
              <b class="mr2">${state.channel}</b>
            </div>
            <p class="flex-grow flex items-center f6 gray code ma0 lh-copy measure-wide">
              ${state.connected ? html`<span><span class="v-mid mr2 bg-light-blue dib pulse-circle"></span>connected</span>` : 'Connecting...'}
            </p>
          </div>
          ${state.messages.map(data => {
            var msgEl = html`<p class="f5 mt2 lh-copy code"></p>`
            msgEl.innerHTML = data.html

            return html`
              <div class="pa2 ph5-ns bb b--black-10">
                <div class="f6 mt3 ttu tracked">
                  <b class="mr2">${data.from}</b><span class="">${data.moment.fromNow()}</span>
                  <br><span class="f7 mid-gray">${data.gitter ? 'via gitter  ' : ''}</span>
                </div>
                ${msgEl}
              </div>
            `
          })}
        </div>
      </div>
    </body>
  `

  function onScroll (e) {
    // emit at bottom
    if ((window.innerHeight + window.scrollY + 250) >= document.body.offsetHeight) {
      emit('scroll')
    }
  }
}

function updateTimestamps (state, emitter) {
  // render on inactivty to update timestamps
  var activityTimeout = setTimeout(inActive, 5000)
  emitter.on('render', function () {
    clearTimeout(activityTimeout)
    activityTimeout = setTimeout(inActive, 5000)
  })

  function inActive () {
    emitter.emit('render')
  }
}

function connectWs (state, emitter) {
  state = Object.assign(state, {
    channel: '#dat',
    key: '227d9212ee85c0f14416885c5390f2d270ba372252e781bf45a6b7056bb0a1b5',
    feed: null,
    messages: [],
    connected: false,
    startIndex: 1,
    wsUrl: 'ws://archiver.jhand.space' // TODO: configure ws endpoint?
  })

  if (!state.feed) createFeed(state.key)

  emitter.on('scroll', function () {
    var loadNum = 7
    var msgs = []
    state.startIndex = Math.max(state.startIndex - loadNum, 1)

    var stream = state.feed.createReadStream({live: false, start: state.startIndex, end: state.startIndex + loadNum})
    stream.on('data', function (data) {
      msgs.unshift(parseMessage(data))
    })
    stream.on('end', function () {
      state.messages = state.messages.concat(msgs)
      emitter.emit('render')
    })
  })

  emitter.on('message', function (data) {
    var msg = parseMessage(data)
    state.messages.unshift(msg)
    emitter.emit('render')
  })

  function parseMessage (data) {
    if (data.from === 'dat-gitter') {
      var split = data.message.split(/(\([\S]*\))/)
      data.gitter = true
      // long gitter messages don't have username at beginning
      if (split.length > 1) {
        data.from = split[1].slice(1,split[1].length - 1)
        data.message = split[2]
      } else {
        // continued message, get previous message user
        data.from = state.messages[0].from
        data.message = split[0]
      }
    }

    data.moment = moment(data.timestamp)
    data.html = Autolinker.link(data.message)
    return data
  }

  function createFeed () {
    var feed = hypercore(ram, state.key, {sparse: true, valueEncoding: 'json'})

    feed.on('ready', function () {
      state.connected = true
      state.feed = feed
      emitter.emit('log:info', 'feed ready')
      emitter.emit('log:info', feed.length)

      feed.update(function () {
        state.startIndex = Math.max(feed.length - 20, 1)
        feed.createReadStream({live: true, start: state.startIndex}).on('data', function (data) {
          emitter.emit('message', data)
        })
      })
    })

    feed.on('download', function () {
      state.connected = true
    })

    replicate()

    function replicate () {
      var ws = wss(state.wsUrl)
      ws.on('connect', function () {
        state.connected = true
      })
      pump(ws, feed.replicate({live: true}), ws, function (err) {
        emitter.emit('log:error', err)
        state.connected = false
        replicate() // again if it closes?
      })
    }
  }
}
