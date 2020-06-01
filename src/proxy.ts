import HttpMitmProxy from 'http-mitm-proxy'
import Fsx from 'fs-extra'
import Path from 'path'
import { Spec, Resource } from './spec'
import { ProxyUrl } from './url'
import Zlib from 'zlib'
import Stream from 'stream'
import { ServerResponse } from 'http'
import { Throttle } from 'stream-throttle'

export type PlaybackProxyMode = 'online' | 'offline' | 'mixed'

const DEFAULT_DATA_STORE = 'default'

export class PlaybackProxy {
  static specFile = 'spec.json'
  cacheRoot: string = ''
  cascading: string[] = []
  port: number = 8080
  mode: PlaybackProxyMode = 'online'
  throttling = true
  latencyGap = 15
  responseDebugHeaders = false
  proxy!: HttpMitmProxy.IProxy
  spec: Spec = new Spec()

  constructor(values: Partial<PlaybackProxy> = {}) {
    if (values.cacheRoot !== undefined) this.cacheRoot = values.cacheRoot
    if (values.cascading !== undefined) this.cascading = values.cascading
    if (values.port !== undefined) this.port = values.port
    if (values.mode !== undefined) this.mode = values.mode
    if (values.throttling !== undefined) this.throttling = values.throttling
    if (values.latencyGap !== undefined) this.latencyGap = values.latencyGap
    if (values.responseDebugHeaders !== undefined) this.responseDebugHeaders = values.responseDebugHeaders
    this.proxy = HttpMitmProxy()
  }

  specFilePath() {
    const path = Path.join(this.cacheRoot, PlaybackProxy.specFile)
    return path
  }

  async loadSpec() {
    if (this.cacheRoot) {
      if (await Fsx.pathExists(this.specFilePath())) {
        const json = await Fsx.readFile(this.specFilePath())
        this.spec = new Spec(JSON.parse(json.toString()) as Partial<Spec>)
      }
    }
  }

  async saveSpec() {
    if (this.cacheRoot) {
      await Fsx.ensureFile(this.specFilePath())
      const json = this.spec.toJson()
      await Fsx.writeFile(this.specFilePath(), json)
    }
  }

  async loadDataFile(res: Resource) {
    if (this.cacheRoot) {
      const path = Path.join(this.cacheRoot, res.path)
      try {
        const buffer = await Fsx.readFile(path)
        return buffer
      } catch (ex) {
        return
      }
    }
    return Buffer.from('')
  }

  async dataFileStream(res: Resource, cascadings: string[] = []): Promise<Stream.Readable> {
    if (this.cacheRoot) {
      for (let cascade of cascadings.concat(this.cascading, DEFAULT_DATA_STORE).filter((c) => c !== '')) {
        const path = Path.join(this.cacheRoot, cascade, res.path)
        if (await Fsx.pathExistsSync(path)) return Fsx.createReadStream(path)
      }
      throw new Error('data file not found')
    } else {
      throw new Error('requires cacheRoot')
    }
  }

  async saveDataFile(res: Resource, buffer: Buffer) {
    if (buffer.length < 1) return
    if (this.cacheRoot) {
      const path = Path.join(this.cacheRoot, DEFAULT_DATA_STORE, res.path)
      await Fsx.ensureFile(path)
      await Fsx.writeFile(path, buffer)
    }
  }

  setupResponseAsOnline(ctx: HttpMitmProxy.IContext) {
    const clientRequest = ctx.clientToProxyRequest
    const fullUrl = [ctx.isSSL ? 'https' : 'http', '://', clientRequest.headers.host || '', clientRequest.url].join('')

    const resource = this.spec.newResource({
      method: clientRequest.method,
      url: fullUrl,
    })
    const requestStarted = +new Date()
    let downloadStarted = requestStarted

    let encoding = clientRequest.headers['accept-encoding']
    if (encoding) {
      const value = encoding instanceof Array ? encoding[0] : encoding
      ctx.proxyToServerRequestOptions.headers['accept-encoding'] = value.match(/\bgzip\b/) ? 'gzip' : '*'
    }

    const chunks: Buffer[] = []
    ctx.onResponse((ctx, cb) => {
      downloadStarted = +new Date()
      resource.ttfb = downloadStarted - requestStarted
      const response = ctx.serverToProxyResponse
      resource.headers = Object.assign({}, response.headers)
      resource.originTransferSize = parseInt(response.headers['content-length'] || '0')
      resource.originContentEncoding = response.headers['content-encoding'] || ''

      if (this.responseDebugHeaders) {
        response.headers['x-origin-content-encoding'] = resource.originContentEncoding
        response.headers['x-origin-transfer-size'] = resource.originTransferSize.toString()
      }

      cb()
    })

    // Bacause if use gunzip first, onResponce will receive response as transfer-encoding: chunk and content-type: undefined.
    ctx.use(HttpMitmProxy.gunzip)

    ctx.onResponseData((ctx, chunk, cb) => {
      chunks.push(chunk)
      cb(undefined, chunk)
    })
    ctx.onResponseEnd((ctx, cb) => {
      const downloadFinished = +new Date()
      resource.originDuration = downloadFinished - downloadStarted

      const buffer = Buffer.concat(chunks)
      resource.originResourceSize = buffer.length
      if (resource.originTransferSize <= 0) resource.originTransferSize = buffer.length

      this.saveDataFile(resource, buffer)
        .then(() => cb())
        .catch((err: any) => cb(err))
    })
  }

  responseWithPlayback(ctx: HttpMitmProxy.IContext, ifNotFound: (response: ServerResponse) => void) {
    const request = ctx.clientToProxyRequest
    const fullUrl = [ctx.isSSL ? 'https' : 'http', '://', request.headers.host || '', request.url].join('')

    const response = ctx.proxyToClientResponse
    const resource = this.spec.findNearestResource(request.method || 'get', fullUrl)
    if (resource) {
      ctx.use(HttpMitmProxy.gunzip)

      for (let key in resource.headers) {
        const value = resource.headers[key] || ''
        response.setHeader(key, value)
      }

      if (this.responseDebugHeaders) {
        response.setHeader('x-playback', '1')
        response.setHeader('x-origin-content-encoding', resource.originContentEncoding)
        response.setHeader('x-origin-resource-size', resource.originResourceSize.toString())
        response.setHeader('x-origin-ttfb', resource.ttfb.toString())
        response.setHeader('x-origin-transfer-duration', resource.originDuration.toString())
        response.setHeader('x-origin-transfer-size', resource.originTransferSize.toString())
      }

      const handler = () => {
        try {
          const cascadingHeader = request.headers['x-proxy-cascade'] || ''
          const cascadings: string[] = Array.isArray(cascadingHeader) ? cascadingHeader : cascadingHeader.split(/\s*,\s*/)

          this.dataFileStream(resource, cascadings)
            .then((stream) => {
              response.statusCode = 200
              response.removeHeader('content-length')

              let st = stream
              if (response.getHeader('content-encoding') === 'gzip') {
                const gzip = Zlib.createGzip()
                st = stream.pipe(gzip)
              } else {
                st = stream
              }

              const rate = resource.originBytesPerSecond(-this.latencyGap)
              if (this.throttling && rate > 0) {
                st = st.pipe(new Throttle({ rate, chunksize: 512 }))
              }

              st.pipe(response)
            })
            .catch((ex) => {
              ifNotFound(response)
            })
        } catch (ex) {
          response.statusCode = 500
          response.end(ex.message)
        }
      }

      if (this.throttling) {
        setTimeout(handler, resource.ttfb - this.latencyGap)
      } else {
        handler()
      }
    } else {
      return ifNotFound(response)
    }
  }

  async start() {
    await this.loadSpec()

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

    await new Promise((resolve, reject) => {
      this.proxy.listen({ port: this.port }, (err: any) => {
        if (err) reject(err)
        resolve()
      })
    })
  }

  async stop() {
    await this.proxy.close()
    await this.saveSpec()
  }
}
