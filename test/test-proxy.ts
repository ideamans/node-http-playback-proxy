import { PlaybackProxy } from '../src/proxy'
import HttpServer from 'http-server'
import Tmp from 'tmp-promise'
import GetPort from 'get-port'
import Path from 'path'
import Axios from 'axios'
import Request from 'request'
import Https from 'https'
import anyTest, { TestInterface } from 'ava'
import Fsx from 'fs-extra'

const test = anyTest as TestInterface<{
  originPort: number
  tmpDir: Tmp.DirectoryResult
  server: any
}>

test.beforeEach(async (t) => {
  t.context.originPort = await GetPort()
  t.context.server = HttpServer.createServer({ root: Path.join(__dirname, 'origin') })
  t.context.server.listen({ port: t.context.originPort })
  t.context.tmpDir = await Tmp.dir({ unsafeCleanup: true })
})

test.afterEach(async (t) => {
  t.context.server.close()
  await t.context.tmpDir.cleanup()
})

test('プロキシのオンラインでの動作について', async (t) => {
  const proxyPort = await GetPort()
  const pp = new PlaybackProxy({
    cacheRoot: t.context.tmpDir.path,
    port: proxyPort,
  })
  await pp.start()

  const url = `http://localhost:${t.context.originPort}/index.html?name=value`
  const res = await Axios.get(url, {
    proxy: { host: 'localhost', port: proxyPort },
    httpsAgent: new Https.Agent({
      rejectUnauthorized: false,
    }),
  })

  const html = res.data
  t.regex(html, /the origin/)

  await pp.stop()

  t.is(pp.spec.resources.length, 1)
})
