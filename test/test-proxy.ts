import { PlaybackProxy } from '../src/proxy'
import HttpServer from 'http-server'
import Tmp from 'tmp-promise'
import GetPort from 'get-port'
import Path from 'path'
import Axios, { AxiosInstance, AxiosResponse } from 'axios'
import Request from 'request'
import Https from 'https'
import anyTest, { TestInterface, ExecutionContext } from 'ava'
import Fsx from 'fs-extra'
import Compression from 'compression'
import { Server } from 'http'
import { ok } from 'assert'

type MyProperties = {
  originPort: number
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
    cacheRoot: t.context.tmpDir.path,
    port: t.context.proxyPort,
    responseExtraHeaders: true,
  })
})

test.afterEach(async (t) => {
  t.context.server.close()
  await t.context.tmpDir.cleanup()
})

type SenarioOptions = {
  testResponseHeader?: (t: ExecutionContext<MyProperties>, res: AxiosResponse, message: string) => Promise<void>
}

async function testProxySenario(t: ExecutionContext<MyProperties>, options: SenarioOptions = {}) {
  await t.context.proxy.start()

  // Online
  const onlineUrl = `http://localhost:${t.context.originPort}/index.html?name=value`
  const resOnline = await t.context.axios.get(onlineUrl)
  t.regex(resOnline.data, /the origin/, 'online proxy returns the origin.')
  t.is(resOnline.headers['x-playback'], undefined, 'online proxy never returns x-playback header.')
  if (options.testResponseHeader) await options.testResponseHeader(t, resOnline, 'online response header')

  await t.context.proxy.saveSpec()
  t.is(t.context.proxy.spec.resources.length, 1, 'offline proxy spec got the first resource.')

  // Offline
  t.context.proxy.mode = 'offline'

  // Playback
  const resPlayback = await t.context.axios.get(onlineUrl)
  t.regex(resPlayback.data, /the origin/, 'offline proxy returns the same as the origin.')
  t.is(resPlayback.headers['x-playback'], '1', 'offline proxy but returns x-playback header.')
  if (options.testResponseHeader) await options.testResponseHeader(t, resOnline, 'playback response header')

  // 404 from offline
  await t.throwsAsync(
    async () => {
      const urlNotFound = `http://localhost:${t.context.originPort}/not-found.html`
      await t.context.axios.get(urlNotFound)
    },
    /404/,
    'offline proxy throws 404'
  )

  await t.context.proxy.saveSpec()
  t.is(t.context.proxy.spec.resources.length, 1, 'offline proxy spec got no resource.')

  // Slight change response
  const similarUrl = `http://localhost:${t.context.originPort}/index.html?name=value1`
  const resSimilar = await t.context.axios.get(similarUrl)
  t.regex(resSimilar.data, /the origin/, 'offline proxy returns from similar url cache.')
  t.is(resSimilar.headers['x-playback'], '1', 'offline proxy but returns x-playback header.')

  if (options.testResponseHeader) await options.testResponseHeader(t, resSimilar, 'similar response header')

  await t.context.proxy.saveSpec()
  t.is(t.context.proxy.spec.resources.length, 1, 'offline proxy spec got no resource.')

  // modify cache contents
  const cachePath = Path.join(t.context.tmpDir.path, 'get', 'http', `localhost~${t.context.originPort}`, 'index~name=value.html')
  const cacheHtml = await Fsx.readFile(cachePath)
  await Fsx.writeFile(cachePath, cacheHtml.toString().replace(/the origin/g, 'ORIGIN'))
  const resOfflineChange = await t.context.axios.get(onlineUrl)
  t.regex(resOfflineChange.data, /ORIGIN/, 'offline proxy returns modified content in cache')
  t.is(resOfflineChange.headers['x-playback'], '1', 'offline proxy but returns x-playback header.')
  if (options.testResponseHeader) await options.testResponseHeader(t, resOfflineChange, 'modified cache response header')

  // Mixed
  t.context.proxy.mode = 'mixed'

  // mixed proxy returnes cache if exists
  const resMixed = await t.context.axios.get(onlineUrl)
  t.regex(resMixed.data, /ORIGIN/, 'mixied proxy returns cache if exists.')
  t.is(resMixed.headers['x-playback'], '1', 'offline proxy but returns x-playback header.')
  if (options.testResponseHeader) await options.testResponseHeader(t, resMixed, 'mixed response header')

  // new request for mixed proxy
  const mixedNewUrl = `http://localhost:${t.context.originPort}/index.html?longlonglonglonglonglonglonglonglonglong`
  const resMixedNew = await t.context.axios.get(mixedNewUrl)
  t.regex(resMixedNew.data, /the origin/, 'mixied proxy returns from origin about an another url.')
  t.is(resMixedNew.headers['x-playback'], undefined, 'mixed proxy never returns x-playback header if the cache not exists.')
  if (options.testResponseHeader) await options.testResponseHeader(t, resMixedNew, 'mixed new resource response header')

  // cache contents
  const mixedCachePath = Path.join(t.context.tmpDir.path, 'get', 'http', `localhost~${t.context.originPort}`, 'index~longlonglonglonglonglonglonglonglonglong.html')
  const mixedCache = await Fsx.readFile(mixedCachePath)
  t.regex(mixedCache.toString(), /the origin/, 'cache created by mixed proxy and includes "the origin".')

  await t.context.proxy.saveSpec()
  t.is(t.context.proxy.spec.resources.length, 2, 'mixed proxy spec got a new resource.')

  await t.context.proxy.stop()
}

test('In no content-encoding', async (t) => {
  t.context.originPort = await GetPort()
  t.context.server = HttpServer.createServer({ root: Path.join(__dirname, 'origin') })
  t.context.server.listen({ port: t.context.originPort })

  t.context.axios = Axios.create({
    proxy: { host: 'localhost', port: t.context.proxyPort },
    // httpsAgent: new Https.Agent({
    //   rejectUnauthorized: false,
    // }),
  })

  await testProxySenario(t, {
    testResponseHeader: async (t, res) => {
      t.is(res.headers['x-origin-content-encoding'], '')
      t.is(res.headers['x-origin-transfer-size'], '115')
    },
  })
})

test('In gzip content-encoding', async (t) => {
  t.context.originPort = await GetPort()
  t.context.server = HttpServer.createServer({ root: Path.join(__dirname, 'origin'), gzip: true })
  t.context.server.listen({ port: t.context.originPort })

  t.context.axios = Axios.create({
    proxy: { host: 'localhost', port: t.context.proxyPort },
    headers: {
      'accept-encoding': 'gzip',
    },
  })

  await testProxySenario(t, {
    testResponseHeader: async (t, res, message) => {
      t.is(res.headers['x-origin-content-encoding'], 'gzip', message)
      t.is(res.headers['x-origin-transfer-size'], '105', message)
    },
  })
})
