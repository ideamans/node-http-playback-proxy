import { PlaybackProxy } from '../src/proxy'
import Http from 'http'
import HttpServer from 'http-server'
import Tmp from 'tmp-promise'
import GetPort from 'get-port'
import Path from 'path'
import Axios, { AxiosInstance, AxiosResponse } from 'axios'
import anyTest, { TestInterface, ExecutionContext } from 'ava'
import Fsx from 'fs-extra'
import { Server } from 'http'
import { LoremIpsum } from 'lorem-ipsum'
import { Readable } from 'stream'
import { Throttle } from 'stream-throttle'

type MyProperties = {
  serverPort: number
  tmpDir: Tmp.DirectoryResult
  server: Server
  proxyPort: number
  proxy: PlaybackProxy
  axios: AxiosInstance
}

const test = anyTest as TestInterface<MyProperties>

test.beforeEach(async (t) => {
  t.context.tmpDir = await Tmp.dir({ unsafeCleanup: true })
  t.context.proxyPort = await GetPort()
  t.context.proxy = new PlaybackProxy({
    saveDir: t.context.tmpDir.path,
    port: t.context.proxyPort,
    responseDebugHeaders: true,
    ignoreParams: ['ignore'],
  })
})

test.afterEach(async (t) => {
  t.context.server.close()
  await t.context.tmpDir.cleanup()
})

type SenarioOptions = {
  testResponseHeader?: (
    t: ExecutionContext<MyProperties>,
    res: AxiosResponse,
    message: string
  ) => Promise<void>
  testOnline?: (
    t: ExecutionContext<MyProperties>,
    res: AxiosResponse,
    message: string
  ) => Promise<void>
}

async function testProxySenario(
  t: ExecutionContext<MyProperties>,
  options: SenarioOptions = {}
) {
  await t.context.proxy.start()

  const targetUrl = `http://localhost:${t.context.serverPort}/index.html?name=value&ignore=1`
  const targetUrlIgnoreParam = `http://localhost:${t.context.serverPort}/index.html?name=value&ignore=2`

  // Online
  await (async () => {
    const resOnline = await t.context.axios.get(targetUrl)
    t.regex(resOnline.data, /the origin/, 'online proxy returns the origin.')
    t.is(
      resOnline.headers['x-playback'],
      undefined,
      'online proxy never returns x-playback header.'
    )
    if (options.testResponseHeader)
      await options.testResponseHeader(t, resOnline, 'online response header')

    await t.context.proxy.saveNetwork()
    t.is(
      t.context.proxy.network.resourcesLength,
      1,
      'offline proxy network got the first resource.'
    )

    if (options.testOnline)
      await options.testOnline(t, resOnline, 'test about online')
  })()

  // Offline
  t.context.proxy.mode = 'offline'

  await (async () => {
    // Playback
    const resPlayback1 = await t.context.axios.get(targetUrl)
    t.regex(
      resPlayback1.data,
      /the origin/,
      'offline proxy returns the same as the origin.'
    )
    t.is(
      resPlayback1.headers['x-playback'],
      '1',
      'offline proxy but returns x-playback header.'
    )
    if (options.testResponseHeader)
      await options.testResponseHeader(
        t,
        resPlayback1,
        'playback response header'
      )

    // Playback (ignore param)
    const resPlayback2 = await t.context.axios.get(targetUrlIgnoreParam)
    t.regex(
      resPlayback2.data,
      /the origin/,
      'offline proxy returns the same as the origin.'
    )
    t.is(
      resPlayback2.headers['x-playback'],
      '1',
      'offline proxy but returns x-playback header.'
    )
    if (options.testResponseHeader)
      await options.testResponseHeader(
        t,
        resPlayback2,
        'playback response header'
      )

    // 404 from offline
    await t.throwsAsync(
      async () => {
        const urlNotFound = `http://localhost:${t.context.serverPort}/not-found.html`
        await t.context.axios.get(urlNotFound)
      },
      /404/,
      'offline proxy throws 404'
    )

    await t.context.proxy.saveNetwork()
    t.is(
      t.context.proxy.network.resourcesLength,
      1,
      'offline proxy network got no resource.'
    )
  })()

  await (async () => {
    // modify cache contents
    const cachePath = Path.join(
      t.context.tmpDir.path,
      'get',
      'http',
      `localhost~${t.context.serverPort}`,
      'index~name=value&ignore=.html'
    )
    const cacheHtml = await Fsx.readFile(cachePath)
    await Fsx.writeFile(
      cachePath,
      cacheHtml.toString().replace(/the origin/g, 'ORIGIN')
    )
    const resOfflineChange = await t.context.axios.get(targetUrl)
    t.regex(
      resOfflineChange.data,
      /ORIGIN/,
      'offline proxy returns modified content in cache'
    )
    t.is(
      resOfflineChange.headers['x-playback'],
      '1',
      'offline proxy but returns x-playback header.'
    )
    if (options.testResponseHeader)
      await options.testResponseHeader(
        t,
        resOfflineChange,
        'modified cache response header'
      )
  })()

  // Mixed
  t.context.proxy.mode = 'mixed'

  await (async () => {
    // mixed proxy returns cache if exists
    const resMixed1 = await t.context.axios.get(targetUrl)
    t.regex(resMixed1.data, /ORIGIN/, 'mixed proxy returns cache if exists.')
    t.is(
      resMixed1.headers['x-playback'],
      '1',
      'offline proxy but returns x-playback header.'
    )
    if (options.testResponseHeader)
      await options.testResponseHeader(t, resMixed1, 'mixed response header')

    // mixed proxy returns cache if exists (ignore param)
    const resMixed2 = await t.context.axios.get(targetUrlIgnoreParam)
    t.regex(resMixed2.data, /ORIGIN/, 'mixed proxy returns cache if exists.')
    t.is(
      resMixed2.headers['x-playback'],
      '1',
      'offline proxy but returns x-playback header.'
    )
    if (options.testResponseHeader)
      await options.testResponseHeader(t, resMixed2, 'mixed response header')
  })()

  await (async () => {
    // new request for mixed proxy
    const mixedNewUrl = `http://localhost:${t.context.serverPort}/index.html?longlonglonglonglonglonglonglonglonglong`
    const resMixedNew = await t.context.axios.get(mixedNewUrl)
    t.regex(
      resMixedNew.data,
      /the origin/,
      'mixed proxy returns from origin about an another url.'
    )
    t.is(
      resMixedNew.headers['x-playback'],
      undefined,
      'mixed proxy never returns x-playback header if the cache not exists.'
    )
    if (options.testResponseHeader)
      await options.testResponseHeader(
        t,
        resMixedNew,
        'mixed new resource response header'
      )
  })()

  await (async () => {
    // cache contents
    const mixedCachePath = Path.join(
      t.context.tmpDir.path,
      'get',
      'http',
      `localhost~${t.context.serverPort}`,
      'index~longlonglonglonglonglonglonglonglonglong.html'
    )
    const mixedCache = await Fsx.readFile(mixedCachePath)
    t.regex(
      mixedCache.toString(),
      /the origin/,
      'cache created by mixed proxy and includes "the origin".'
    )

    await t.context.proxy.saveNetwork()
    t.is(
      t.context.proxy.network.resourcesLength,
      2,
      'mixed proxy network got a new resource.'
    )
  })()

  await t.context.proxy.stop()
}

test('In no content-encoding', async (t) => {
  t.context.serverPort = await GetPort()
  t.context.server = HttpServer.createServer({
    root: Path.join(__dirname, 'server'),
  })
  t.context.server.listen({ port: t.context.serverPort })

  t.context.axios = Axios.create({
    proxy: { host: 'localhost', port: t.context.proxyPort },
    // httpsAgent: new Https.Agent({
    //   rejectUnauthorized: false,
    // }),
  })

  await testProxySenario(t, {
    testResponseHeader: async (t, res) => {
      t.is(res.headers['x-playback-server-content-encoding'], '')
      t.is(res.headers['x-playback-server-transfer-size'], '126')
    },
  })
})

test('In gzip content-encoding', async (t) => {
  t.context.serverPort = await GetPort()
  t.context.server = HttpServer.createServer({
    root: Path.join(__dirname, 'server'),
    gzip: true,
  })
  t.context.server.listen({ port: t.context.serverPort })

  t.context.axios = Axios.create({
    proxy: { host: 'localhost', port: t.context.proxyPort },
    headers: {
      'accept-encoding': 'gzip',
    },
  })

  await testProxySenario(t, {
    testResponseHeader: async (t, res, message) => {
      t.is(res.headers['x-playback-server-content-encoding'], 'gzip', message)
      t.is(res.headers['x-playback-server-transfer-size'], '105', message)
    },
    testOnline: async (t, res, message) => {
      const resource = t.context.proxy.network.getResource(0)
      t.is(resource.server.size, 115)
      t.is(resource.server.transfer, 105)
    },
  })
})

test('TTFB', async (t) => {
  t.context.serverPort = await GetPort()
  t.context.server = Http.createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.write(new LoremIpsum().generateParagraphs(100))
      res.end()
    }, 500)
  })
  t.context.server.listen(t.context.serverPort)

  await t.context.proxy.start()
  t.context.axios = Axios.create({
    proxy: { host: 'localhost', port: t.context.proxyPort },
  })

  // Recording
  await t.context.axios.get(`http://localhost:${t.context.serverPort}/`)
  t.context.proxy.mode = 'offline'

  const started = +new Date()
  const resProxy = await t.context.axios.get(
    `http://localhost:${t.context.serverPort}/`
  )
  const headerTtfb = parseInt(
    resProxy.headers['x-playback-server-ttfb'].toString()
  )
  const actualTime = +new Date() - started
  t.true(Math.abs(headerTtfb - 500) < 100)
  t.true(Math.abs(actualTime - 500) < 100)
})

test('Data rate', async (t) => {
  const content = Buffer.from(new LoremIpsum().generateParagraphs(100))
  const rate = content.length / 0.5
  const chunksize = content.length / 10
  t.context.serverPort = await GetPort()
  t.context.server = Http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    let st = Readable.from([content])
    st = st.pipe(new Throttle({ rate, chunksize }))
    st.pipe(res)
  })
  t.context.server.listen(t.context.serverPort)

  await t.context.proxy.start()
  t.context.axios = Axios.create({
    proxy: { host: 'localhost', port: t.context.proxyPort },
  })

  // Recording
  await t.context.axios.get(`http://localhost:${t.context.serverPort}/`)
  t.context.proxy.mode = 'offline'

  // Natural speed
  await (async () => {
    const started = +new Date()
    await t.context.axios.get(`http://localhost:${t.context.serverPort}/`)
    const actualTime = +new Date() - started
    t.true(
      Math.abs(actualTime - 500) < 150,
      'Offline response time almost reproduces online data rate'
    )
  })()

  // Fast
  await (async () => {
    t.context.proxy.speed = 2.0
    const started = +new Date()
    await t.context.axios.get(`http://localhost:${t.context.serverPort}/`)
    const actualTime = +new Date() - started
    t.true(
      Math.abs(actualTime - 250) < 100,
      'Offline response time almost reproduces online data rate x2 fast'
    )
  })()

  // Slow
  await (async () => {
    t.context.proxy.speed = 0.5
    const started = +new Date()
    await t.context.axios.get(`http://localhost:${t.context.serverPort}/`)
    const actualTime = +new Date() - started
    t.true(
      Math.abs(actualTime - 1000) < 100,
      'Offline response time almost reproduces online data rate x2 slow'
    )
  })()

  // No throttling
  await (async () => {
    t.context.proxy.throttling = false
    const started = +new Date()
    await t.context.axios.get(`http://localhost:${t.context.serverPort}/`)
    const actualTime = +new Date() - started
    t.true(Math.abs(actualTime - 100) < 100, 'Offline response speed faster')
  })()

  // No throttling but fixed data rate
  await (async () => {
    t.context.proxy.throttling = false
    t.context.proxy.fixedDataRate = content.length / 1
    const started = +new Date()
    await t.context.axios.get(`http://localhost:${t.context.serverPort}/`)
    const actualTime = +new Date() - started
    t.true(Math.abs(actualTime - 1000) < 150, 'Offline response speed slow')
  })()
})
