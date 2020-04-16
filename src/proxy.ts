import HttpMitmProxy from 'http-mitm-proxy'
import Fsx from 'fs-extra'
import Path from 'path'
import { Spec, Resource } from './spec'
import { ProxyUrl } from './url'

export class PlaybackProxy {
  static specFile = '.spec.json'
  cacheRoot: string = ''
  port: number = 8080
  online: boolean = true
  proxy!: HttpMitmProxy.IProxy
  spec: Spec = new Spec()

  constructor(values: Partial<PlaybackProxy> = {}) {
    if (values.cacheRoot !== undefined) this.cacheRoot = values.cacheRoot
    if (values.port !== undefined) this.port = values.port
    if (values.online !== undefined) this.online = values.online
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

  async saveDataFile(res: Resource, buffer: Buffer) {
    if (buffer.length < 1) return
    if (this.cacheRoot) {
      const path = Path.join(this.cacheRoot, res.path)
      await Fsx.ensureFile(path)
      await Fsx.writeFile(path, buffer)
    }
  }

  setupResponseSaver(ctx: HttpMitmProxy.IContext) {
    const request = ctx.clientToProxyRequest
    const fullUrl = [ctx.isSSL ? 'https' : 'http', '://', request.headers.host || '', request.url].join('')

    const res = this.spec.newResource({
      method: request.method,
      url: fullUrl,
    })
    const requestStarted = +new Date()
    let downloadStarted = requestStarted

    const chunks: Buffer[] = []
    ctx.use(HttpMitmProxy.gunzip)
    ctx.onResponse((ctx, cb) => {
      downloadStarted = +new Date()
      res.ttfb = downloadStarted - requestStarted
      const response = ctx.serverToProxyResponse
      res.headers = response.headers
      cb()
    })
    ctx.onResponseData((ctx, chunk, cb) => {
      chunks.push(chunk)
      cb(undefined, chunk)
    })
    ctx.onResponseEnd((ctx, cb) => {
      const downloadFinished = +new Date()
      res.originalDuration = downloadFinished - downloadStarted

      const buffer = Buffer.concat(chunks)
      res.originalLength = buffer.length

      console.log(res)

      this.saveDataFile(res, buffer)
        .then(() => cb())
        .catch((err: any) => cb(err))
    })
  }

  async start() {
    await this.loadSpec()

    this.proxy.onRequest((ctx, cb) => {
      if (this.online) {
        this.setupResponseSaver(ctx)
        cb()
      } else {
        const request = ctx.clientToProxyRequest
        const fullUrl = [ctx.isSSL ? 'https' : 'http', '://', request.headers.host || '', request.url].join('')

        const response = ctx.proxyToClientResponse
        const res = this.spec.findNearestResource(request.method || 'get', fullUrl)
        if (res) {
          console.log(res)
          for (let key in res.headers) {
            const value = res.headers[key] || ''
            response.setHeader(key, value)
          }
          this.loadDataFile(res)
            .then((data) => {
              if (data) {
                response.statusCode = 200
                response.end(data)
              } else {
                response.statusCode = 404
                response.end()
              }
            })
            .catch((err: any) => {
              response.statusCode = 500
              response.end()
            })
        } else {
          response.statusCode = 404
          response.end()
        }
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
