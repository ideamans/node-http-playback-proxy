import HttpMitmProxy from 'http-mitm-proxy'
import Fsx from 'fs-extra'
import Path from 'path'
import { Network, Resource } from './network'
import Zlib from 'zlib'
import Stream, { Transform, TransformCallback } from 'stream'
import { ServerResponse } from 'http'
import { Throttle } from 'stream-throttle'
import { ProxyUrl } from './url'

export type PlaybackProxyMode = 'online' | 'offline' | 'mixed'

function hrtimeToMs(hrtime: [number, number]) {
  return hrtime[0] * 1000 + hrtime[1] / 1e6
}

export class PlaybackProxy {
  static networkFile = 'network.json'
  saveDir: string = ''
  port: number = 8080
  host: string = 'localhost'
  keepAlive: boolean = false
  proxyTimeout: number = 0
  mode: PlaybackProxyMode = 'online'
  ignoreParams: string[] = []
  waiting = true
  throttling = true
  fixedDataRate = 0
  latencyGap = 0
  responseDebugHeaders = false
  proxy?: HttpMitmProxy.IProxy
  network: Network = new Network()
  speed: number = 1.0
  sslCaDir: string = ''

  constructor(values: Partial<PlaybackProxy> = {}) {
    if (values.saveDir !== undefined) this.saveDir = values.saveDir
    if (values.port !== undefined) this.port = values.port
    if (values.host !== undefined) this.host = values.host
    if (values.keepAlive !== undefined) this.keepAlive = values.keepAlive
    if (values.proxyTimeout !== undefined)
      this.proxyTimeout = values.proxyTimeout
    if (values.mode !== undefined) this.mode = values.mode
    if (values.ignoreParams !== undefined)
      this.ignoreParams = values.ignoreParams
    if (values.waiting !== undefined) this.waiting = values.waiting
    if (values.throttling !== undefined) this.throttling = values.throttling
    if (values.fixedDataRate !== undefined)
      this.fixedDataRate = values.fixedDataRate
    if (values.latencyGap !== undefined) this.latencyGap = values.latencyGap
    if (values.responseDebugHeaders !== undefined)
      this.responseDebugHeaders = values.responseDebugHeaders
    if (values.speed !== undefined) this.speed = values.speed
    if (values.sslCaDir !== undefined) this.sslCaDir = values.sslCaDir
  }

  networkFilePath() {
    const path = Path.join(this.saveDir, PlaybackProxy.networkFile)
    return path
  }

  async loadNetwork() {
    if (this.saveDir) {
      if (await Fsx.pathExists(this.networkFilePath())) {
        const json = await Fsx.readFile(this.networkFilePath())
        this.network = new Network(
          JSON.parse(json.toString()) as Partial<Network>
        )
      }
    }
  }

  async saveNetwork() {
    if (this.saveDir) {
      await Fsx.ensureFile(this.networkFilePath())
      const json = this.network.toJson(true)
      await Fsx.writeFile(this.networkFilePath(), json)
    }
  }

  async loadDataFile(res: Resource) {
    if (this.saveDir) {
      const path = Path.join(this.saveDir, res.path)
      try {
        const buffer = await Fsx.readFile(path)
        return buffer
      } catch (ex) {
        return
      }
    }
    return Buffer.from('')
  }

  async dataFileStream(res: Resource): Promise<Stream.Readable | undefined> {
    if (this.saveDir) {
      const path = Path.join(this.saveDir, res.path)
      if (Fsx.pathExistsSync(path)) return Fsx.createReadStream(path)
      return
    } else {
      throw new Error('requires resourceRoot')
    }
  }

  async saveDataFile(res: Resource, buffer: Buffer) {
    if (this.saveDir) {
      const path = Path.join(this.saveDir, res.path)
      await Fsx.ensureFile(path)
      await Fsx.writeFile(path, buffer)
    }
  }

  setupResponseAsOnline(ctx: HttpMitmProxy.IContext) {
    const clientRequest = ctx.clientToProxyRequest
    const fullUrl = [
      ctx.isSSL ? 'https' : 'http',
      '://',
      clientRequest.headers.host || '',
      clientRequest.url,
    ].join('')

    const normalizedUrl = ProxyUrl.clearParams(fullUrl, this.ignoreParams)

    const resource = this.network.newResource({
      method: clientRequest.method,
      url: normalizedUrl,
    })
    const requestStarted = process.hrtime()

    let encoding = clientRequest.headers['accept-encoding']
    if (encoding) {
      const value = encoding instanceof Array ? encoding[0] : encoding
      ctx.proxyToServerRequestOptions.headers['accept-encoding'] = value.match(
        /\bgzip\b/
      )
        ? 'gzip'
        : '*'
    }

    const chunks: Buffer[] = []

    // Measure transfer size
    let transferSize = 0
    const counter = new Transform({
      transform(
        chunk: string | Buffer,
        _: string,
        done: TransformCallback
      ): void {
        transferSize += chunk.length
        this.push(chunk)
        done()
      },
    })

    ctx.onResponse((ctx, cb) => {
      resource.server.ttfb = hrtimeToMs(process.hrtime(requestStarted))
      const response = ctx.serverToProxyResponse
      resource.statusCode = response.statusCode || 200
      resource.headers = Object.assign({}, response.headers)

      // transfer-encoding: chunk not needed
      delete resource.headers['transfer-encoding']

      resource.server.transfer = parseInt(
        response.headers['content-length'] || '0'
      )
      resource.server.contentEncoding =
        response.headers['content-encoding'] || ''

      if (this.responseDebugHeaders) {
        response.headers['x-playback-server-content-encoding'] =
          resource.server.contentEncoding
        response.headers['x-playback-server-transfer-size'] =
          resource.server.transfer.toString()
      }

      ctx.addResponseFilter(counter)

      // Write blank file once. If has body, update it with onResponseData and onResponseEnd
      this.saveDataFile(resource, Buffer.from(''))
        .then(() => cb())
        .catch((err) => cb(err))
    })

    // Because if use gunzip first, onResponse will receive response as transfer-encoding: chunk and content-type: undefined.
    ctx.use(HttpMitmProxy.gunzip)

    ctx.onResponseData((ctx, chunk, cb) => {
      chunks.push(chunk)
      cb(undefined, chunk)
    })
    ctx.onResponseEnd((ctx, cb) => {
      resource.server.duration =
        hrtimeToMs(process.hrtime(requestStarted)) - resource.server.ttfb

      const buffer = Buffer.concat(chunks)
      resource.server.size = buffer.length
      resource.server.transfer = transferSize
      if (resource.server.transfer <= 0)
        resource.server.transfer = buffer.length

      this.saveDataFile(resource, buffer)
        .then(() => cb())
        .catch((err: any) => cb(err))
    })
  }

  responseWithPlayback(
    ctx: HttpMitmProxy.IContext,
    ifNotFound: (response: ServerResponse) => void
  ) {
    const request = ctx.clientToProxyRequest
    const fullUrl = [
      ctx.isSSL ? 'https' : 'http',
      '://',
      request.headers.host || '',
      request.url,
    ].join('')

    const normalizedUrl = ProxyUrl.clearParams(fullUrl, this.ignoreParams)

    const response = ctx.proxyToClientResponse
    const resource = this.network.lookupResource(
      request.method || 'get',
      normalizedUrl
    )
    if (resource) {
      ctx.use(HttpMitmProxy.gunzip)

      for (let key in resource.headers) {
        const value = resource.headers[key] || ''
        response.setHeader(key, value)
      }

      if (this.responseDebugHeaders) {
        response.setHeader('x-playback', '1')
        response.setHeader(
          'x-playback-server-content-encoding',
          resource.server.contentEncoding
        )
        response.setHeader(
          'x-playback-server-resource-size',
          resource.server.size.toString()
        )
        response.setHeader(
          'x-playback-server-ttfb',
          resource.server.ttfb.toString()
        )
        response.setHeader(
          'x-playback-server-transfer-duration',
          resource.server.duration.toString()
        )
        response.setHeader(
          'x-playback-server-transfer-size',
          resource.server.transfer.toString()
        )
      }

      const handler = () => {
        try {
          response.statusCode = resource.statusCode
          response.removeHeader('content-length')

          this.dataFileStream(resource)
            .then((stream) => {
              if (!stream) return response.end()

              let st = stream
              if (response.getHeader('content-encoding') === 'gzip') {
                const gzip = Zlib.createGzip()
                st = stream.pipe(gzip)
              } else {
                st = stream
              }

              const rate = resource.serverBytesPerSecond(this.latencyGap)
              if (this.fixedDataRate > 0) {
                st = st.pipe(
                  new Throttle({ rate: this.fixedDataRate, chunksize: 512 })
                )
              } else if (this.throttling && rate > 0) {
                st = st.pipe(
                  new Throttle({
                    rate: rate * this.speed,
                    chunksize: 512,
                  })
                )
              }
              st.pipe(response)
            })
            .catch((ex) => {
              ifNotFound(response)
            })
        } catch (ex) {
          const message = ex instanceof Error ? ex.message : 'unknown error'
          response.statusCode = 500
          response.end(message)
        }
      }

      if (this.waiting) {
        setTimeout(
          handler,
          (resource.server.ttfb + this.latencyGap) / this.speed
        )
      } else {
        handler()
      }
    } else {
      return ifNotFound(response)
    }
  }

  async start() {
    await this.loadNetwork()
    this.proxy = HttpMitmProxy()

    this.proxy.onRequest((ctx, cb) => {
      if (this.mode == 'online') {
        this.setupResponseAsOnline(ctx)
        cb()
      } else {
        this.responseWithPlayback(ctx, (response) => {
          if (this.mode == 'offline') {
            response.statusCode = 404
            response.end()
          } else {
            this.setupResponseAsOnline(ctx)
            cb()
          }
        })
      }
    })

    await new Promise<void>((resolve, reject) => {
      const options: HttpMitmProxy.IProxyOptions = {
        port: this.port,
        host: this.host,
        keepAlive: this.keepAlive,
        timeout: this.proxyTimeout,
      }
      if (this.sslCaDir) options.sslCaDir = this.sslCaDir
      if (!this.proxy) throw new Error('proxy not created')

      this.proxy.listen(options, (err: any) => {
        if (err) reject(err)
        resolve()
      })
    })
  }

  async stop() {
    if (this.proxy) await this.proxy.close()
    await this.saveNetwork()
  }
}
