import { PlaybackProxy } from '../src/proxy'
import { pipeline, Readable } from 'stream'
import { Server, createServer } from 'http'
import { Throttle } from 'stream-throttle'
import GetPort from 'get-port'
import Axios, { AxiosInstance, AxiosResponse } from 'axios'
import anyTest, { TestInterface, ExecutionContext } from 'ava'
import Tmp from 'tmp-promise'

type MyProperties = {
  originPort: number
  tmpDir: Tmp.DirectoryResult
  server: Server
  proxyPort: number
  proxy: PlaybackProxy
  axios: AxiosInstance
}

const test = anyTest as TestInterface<MyProperties>

async function benchmark<T>(
  cb: () => Promise<T>
): Promise<{ duration: number; result: T }> {
  const started = +new Date()
  const result = await cb()
  const finished = +new Date()
  return { duration: finished - started, result }
}

test.beforeEach(async (t) => {
  t.context.tmpDir = await Tmp.dir({ unsafeCleanup: true })
  t.context.proxyPort = await GetPort()
  t.context.proxy = new PlaybackProxy({
    cacheRoot: t.context.tmpDir.path,
    port: t.context.proxyPort,
    responseDebugHeaders: true,
    throttling: true,
    latencyGap: 0,
  })
  await t.context.proxy.start()
})

test.afterEach(async (t) => {
  if (t.context.server) t.context.server.close()
  await t.context.proxy.stop()
  await t.context.tmpDir.cleanup()
})

async function testTtfbAndRate(
  t: ExecutionContext<MyProperties>,
  ttfb: number,
  rate: number,
  size: number
) {
  const downloadTime = (size / rate) * 1000
  const expected = ttfb + downloadTime

  const buffer = Buffer.alloc(size)
  const port = await GetPort()

  t.context.server = createServer((req, res) => {
    setTimeout(() => {
      const stream = new Readable()
      stream.push(buffer)
      stream.push(null)
      stream.pipe(new Throttle({ rate: rate, chunksize: 256 })).pipe(res)

      res.setHeader('Content-Type', 'application/octet-stream')
      res.writeHead(200)
    }, ttfb)
  })
  t.context.server.listen({ port })

  const url = new URL('http://localhost')
  url.port = port.toString()

  // Without proxy
  t.context.axios = Axios.create()
  const withoutProxy = await benchmark<AxiosResponse<any>>(async () => {
    return await t.context.axios.get(url.href)
  })

  t.true(
    Math.abs(withoutProxy.duration - expected) < expected * 0.1,
    'Without proxy'
  )
  t.is(withoutProxy.result.headers['content-type'], 'application/octet-stream')
  t.is(withoutProxy.result.data.length, size)

  // With proxy
  t.context.axios = Axios.create({
    proxy: { host: 'localhost', port: t.context.proxyPort },
  })

  // With online proxy
  t.context.proxy.mode = 'online'
  const withOnlineProxy = await benchmark<AxiosResponse<any>>(async () => {
    return await t.context.axios.get(url.href)
  })

  t.true(
    Math.abs(withOnlineProxy.duration - expected) < expected * 0.1,
    'With online proxy'
  )

  const resource = t.context.proxy.spec.lookupResource('GET', url.href)
  t.true(
    Math.abs(resource.origin.ttfb - ttfb) < Math.max(ttfb * 0.1, 50),
    'TTFB with online proxy'
  )
  t.true(
    Math.abs(resource.origin.duration - downloadTime) <
      Math.max(downloadTime * 0.1, 50),
    'Download duration with online proxy'
  )

  // With offline proxy
  t.context.proxy.mode = 'offline'
  const withOfflineProxy = await benchmark<AxiosResponse<any>>(async () => {
    return await t.context.axios.get(url.href)
  })

  t.true(
    Math.abs(withOfflineProxy.duration - expected) < expected * 0.1,
    'With offline proxy'
  )
}

test('TTFB 0ms and rate 10Kbps', async (t) => {
  for (let size of [5 * 1024]) {
    await testTtfbAndRate(t, 0, 1024 * 10, size)
  }
})

test('TTFB 100ms and rate 1Gbps', async (t) => {
  for (let size of [5 * 1024]) {
    await testTtfbAndRate(t, 500, 1024 * 1024 * 1024 * 1, size)
  }
})

test('TTFB 100ms and rate 10Kbps', async (t) => {
  for (let size of [5 * 1024]) {
    await testTtfbAndRate(t, 500, 1024 * 10, size)
  }
})
