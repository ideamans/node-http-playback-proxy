import { ProxyUrl } from './url'
import Path from 'path'
import QueryString from 'querystring'

export type HeadersType = { [prop: string]: any }

export type ServerMetrics = {
  ttfb: number
  size: number
  transfer: number
  duration: number
  contentEncoding: string
}

export class Resource {
  method: string = 'get'
  url: string = ''
  path: string = ''
  statusCode: number = 200
  headers: HeadersType = {}
  server: ServerMetrics = {
    ttfb: 0,
    size: 0,
    transfer: 0,
    duration: 0,
    contentEncoding: '',
  }
  timestamp: number = +new Date()

  constructor(values: Partial<Resource> = {}) {
    if (values.method !== undefined) this.method = values.method
    if (values.url !== undefined) this.url = values.url
    if (values.path !== undefined) this.path = values.path
    if (values.statusCode !== undefined) this.statusCode = values.statusCode
    if (values.headers !== undefined) this.headers = values.headers
    if (values.server !== undefined) {
      if (values.server.ttfb !== undefined)
        this.server.ttfb = values.server.ttfb
      if (values.server.size !== undefined)
        this.server.size = values.server.size
      if (values.server.transfer !== undefined)
        this.server.transfer = values.server.transfer
      if (values.server.duration !== undefined)
        this.server.duration = values.server.duration
      if (values.server.contentEncoding !== undefined)
        this.server.contentEncoding = values.server.contentEncoding
    }
    if (values.timestamp !== undefined) this.timestamp = values.timestamp

    this.method = this.method.toLowerCase()

    if (!this.path) {
      const u = new ProxyUrl(this.url)
      this.path = u.pathnize(this.method)
    }
  }

  get proxyUrl() {
    return new ProxyUrl(this.url)
  }

  serverBytesPerSecond(gap = 0) {
    if (this.server.duration <= 0) return NaN
    const seconds = (this.server.duration + gap) / 1000
    return this.server.transfer / seconds
  }
}

export class ResourceTag {
  resource!: Resource
  host: string = ''
  path: string = ''
  extname: string = ''
  mimeType: string = ''
  lastMatching: number = 0

  constructor(res: Resource) {
    this.resource = res
    const url = res.proxyUrl
    this.host = url.host
    this.path = url.pathname + url.search || '/'

    const b = Path.basename(url.pathname)
    this.extname = Path.extname(b).toLowerCase()

    const ct = res.headers['content-type'] || ''
    this.mimeType = (Array.isArray(ct) ? ct.shift() : ct)
      .split(';')
      .shift()
      .toLowerCase()
  }
}

export type ResourcesIndex = { [method: string]: { [url: string]: Resource } }
export type ResourceGroup = { [group: string]: Resource[] }

export type ResourceFilterCallback = (
  tag: ResourceTag,
  res: Resource
) => boolean

export class Network {
  private resources: Resource[] = []
  resourcesIndex: ResourcesIndex = {}
  resourcesTags: ResourceTag[] = []

  constructor(
    values: Partial<Network> & { resources?: Array<Partial<Resource>> } = {}
  ) {
    if (values.resources)
      this.resources = values.resources.map((r) => new Resource(r))
    this.reIndex()
  }

  toJson(pretty: boolean = false) {
    const data = { resources: this.resources }
    return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)
  }

  get resourcesLength() {
    return this.resources.length
  }

  getResource(index: number) {
    return this.resources[index]
  }

  putResource(res: Resource) {
    const existed = this.lookupResource(res.method, res.url)
    if (!existed) {
      this.resources.push(res)
      this.indexResource(res)
    }
  }

  newResource(values: Partial<Resource> = {}) {
    const res = new Resource(values)
    this.putResource(res)
    return res
  }

  indexResource(res: Resource) {
    const index = (this.resourcesIndex[res.method] =
      this.resourcesIndex[res.method] || {})
    index[res.url] = res

    this.resourcesTags.push(new ResourceTag(res))
  }

  reIndex() {
    this.resourcesIndex = {}
    this.resourcesTags = []
    for (let res of this.resources) {
      this.indexResource(res)
    }
  }

  lookupResource(method: string, url: string) {
    method = method.toLowerCase()
    const index = (this.resourcesIndex[method] =
      this.resourcesIndex[method] || {})
    return index[url]
  }

  filterResources(cb: ResourceFilterCallback, orderAsc = true) {
    return this.resourcesTags
      .filter((tag) => cb(tag, tag.resource))
      .map((tag) => tag.resource)

      .sort((a, b) =>
        orderAsc ? a.timestamp - b.timestamp : b.timestamp - a.timestamp
      )
  }
}
