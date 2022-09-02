import { ProxyUrl } from './url'
import Path from 'path'
import QueryString from 'querystring'

export type HeadersType = { [prop: string]: any }

export type OriginMetrics = {
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
  origin: OriginMetrics = {
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
    if (values.origin !== undefined) {
      if (values.origin.ttfb !== undefined)
        this.origin.ttfb = values.origin.ttfb
      if (values.origin.size !== undefined)
        this.origin.size = values.origin.size
      if (values.origin.transfer !== undefined)
        this.origin.transfer = values.origin.transfer
      if (values.origin.duration !== undefined)
        this.origin.duration = values.origin.duration
      if (values.origin.contentEncoding !== undefined)
        this.origin.contentEncoding = values.origin.contentEncoding
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

  originBytesPerSecond(gap = 0) {
    if (this.origin.duration <= 0) return NaN
    const seconds = (this.origin.duration + gap) / 1000
    return this.origin.transfer / seconds
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

export type ResourceTree = {
  [method: string]: {
    [protocol: string]: {
      [host: string]: { [path: string]: { [search: string]: Resource } }
    }
  }
}
export type ResourcesIndex = { [method: string]: { [url: string]: Resource } }
export type ResourceGroup = { [group: string]: Resource[] }

export type ResourceFilterCallback = (
  tag: ResourceTag,
  res: Resource
) => boolean

export class Spec {
  private resources: Resource[] = []
  resourceTree: ResourceTree = {}
  resourcesIndex: ResourcesIndex = {}
  resourcesTags: ResourceTag[] = []

  constructor(
    values: Partial<Spec> & { resources?: Array<Partial<Resource>> } = {}
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

    // Tree
    const byMethod = (this.resourceTree[res.method] =
      this.resourceTree[res.method] || {})
    const url = res.proxyUrl
    const byProtocol = (byMethod[url.protocol] = byMethod[url.protocol] || {})
    const byHost = (byProtocol[url.host] = byProtocol[url.host] || {})
    const byPath = (byHost[url.pathname] = byHost[url.pathname] || {})
    byPath[url.search] = res

    this.resourcesTags.push(new ResourceTag(res))
  }

  reIndex() {
    this.resourcesIndex = {}
    this.resourceTree = {}
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

  findNearestResource(method: string, url: string) {
    method = method.toLowerCase()
    const match = this.lookupResource(method, url)
    if (match) return match

    // Traverse tree
    const byProtocol = this.resourceTree[method]
    if (!byProtocol) return

    const res = new Resource({ method, url })
    const u = res.proxyUrl

    const byHost = byProtocol[u.protocol]
    if (!byHost) return

    const byPath = byHost[u.host]
    if (!byPath) return

    const bySearch = byPath[u.pathname]
    if (!bySearch) return

    const searchs = Object.keys(bySearch)
    // Return nomatch if 0: never happen
    if (searchs.length === 0) return

    // Return if the path only one.
    if (searchs.length == 1) return bySearch[searchs[0]]

    // Sort by QueryString distance.
    const theQs = QueryString.parse(u.search)
    const tuples: [string, number][] = searchs.map((qs) => [
      qs,
      ProxyUrl.queryStringDistance(QueryString.parse(qs), theQs),
    ])
    const sorted = tuples.sort((a, b) => a[1] - b[1])

    return bySearch[sorted[0][0]]
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
