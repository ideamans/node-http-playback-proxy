import HttpMitmProxy from 'http-mitm-proxy'
import Fsx from 'fs-extra'
import Path from 'path'
import { Spec, Resource } from './spec'
import { ProxyUrl } from './url'
import Zlib from 'zlib'
import Stream from 'stream'
import { ServerResponse } from 'http'

export type PlaybackProxyMode = 'online' | 'offline' | 'mixed'

export class PlaybackProxy {
  static specFile = 'spec.json'
  cacheRoot: string = ''
  port: number = 8080
  mode: PlaybackProxyMode = 'online'
  responseExtraHeaders = false
  proxy!: HttpMitmProxy.IProxy
  spec: Spec = new Spec()

  constructor(values: Partial<PlaybackProxy> = {}) {
    if (values.cacheRoot !== undefined) this.cacheRoot = values.cacheRoot
    if (values.port !== undefined) this.port = values.port
    if (values.mode !== undefined) this.mode = values.mode
    if (values.responseExtraHeaders !== undefined) this.responseExtraHeaders = values.responseExtraHeaders
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

  dataFileStream(res: Resource): Stream.Readable {
    if (this.cacheRoot) {
      const path = Path.join(this.cacheRoot, res.path)
      return Fsx.createReadStream(path)
    } else {
      throw new Error('requires cacheRoot')
    }
  }

  async saveDataFile(res: Resource, buffer: Buffer) {
    if (buffer.length < 1) return
    if (this.cacheRoot) {
      const path = Path.join(this.cacheRoot, res.path)
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
      resource.originalTransferSize = parseInt(response.headers['content-length'] || '0')
      resource.originalContentEncoding = response.headers['content-encoding'] || ''

      if (this.responseExtraHeaders) {
        response.headers['x-origin-content-encoding'] = resource.originalContentEncoding
        response.headers['x-origin-transfer-size'] = resource.originalTransferSize.toString()
      }
      // console.log('request', fullUrl, ctx.proxyToServerRequest.getHeaders())
      // console.log('response', fullUrl, resource.headers)
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
      resource.originalDuration = downloadFinished - downloadStarted

      const buffer = Buffer.concat(chunks)
      resource.originalResourceSize = buffer.length

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

      if (this.responseExtraHeaders) {
        response.setHeader('x-playback', '1')
        response.setHeader('x-origin-content-encoding', resource.originalContentEncoding)
        response.setHeader('x-origin-resource-size', resource.originalResourceSize.toString())
        response.setHeader('x-origin-transfer-size', resource.originalTransferSize.toString())
      }

      try {
        let stream
        try {
          stream = this.dataFileStream(resource)
        } catch (ex) {
          return ifNotFound(response)
        }
        if (!stream) throw new Error('no stream')

        response.statusCode = 200
        response.removeHeader('content-length')
        if (response.getHeader('content-encoding') === 'gzip') {
          const gzip = Zlib.createGzip()
          stream.pipe(gzip).pipe(response)
        } else {
          stream.pipe(response)
        }
      } catch (ex) {
        response.statusCode = 500
        response.end(ex.message)
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
