import { ProxyUrl } from './url'
import Path from 'path'
import QueryString from 'querystring'

export type HeadersType = { [prop: string]: any }

export class Resource {
  method: string = 'get'
  url: string = ''
  path: string = ''
  headers: HeadersType = {}
  ttfb: number = 0
  originResourceSize: number = 0
  originTransferSize: number = 0
  originContentEncoding: string = ''
  originDuration: number = 0
  timestamp: number = +new Date()

  constructor(values: Partial<Resource> = {}) {
    if (values.url !== undefined) this.setUrl(values.url)
    if (values.method !== undefined) this.method = values.method
    if (values.path !== undefined) this.path = values.path
    if (values.headers !== undefined) this.headers = values.headers
    if (values.ttfb !== undefined) this.ttfb = values.ttfb
    if (values.originTransferSize !== undefined) this.originTransferSize = values.originTransferSize
    if (values.originResourceSize !== undefined) this.originResourceSize = values.originResourceSize
    if (values.originContentEncoding !== undefined) this.originContentEncoding = values.originContentEncoding
    if (values.originDuration !== undefined) this.originDuration = values.originDuration
    if (values.timestamp !== undefined) this.timestamp = values.timestamp
  }

  get proxyUrl() {
    return new ProxyUrl(this.url)
  }

  setUrl(url: string) {
    this.url = url
    const u = new ProxyUrl(url)
    this.path = u.pathnize()
  }

  originBytesPerSecond(gap = 0) {
    if (this.originDuration <= 0) return NaN
    const seconds = (this.originDuration + gap) / 1000
    return this.originTransferSize / seconds
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
    this.mimeType = (Array.isArray(ct) ? ct.shift() : ct).split(';').shift().toLowerCase()
  }
}

export type ResourceTree = { [method: string]: { [protocol: string]: { [host: string]: { [path: string]: { [search: string]: Resource } } } } }
export type ResourcesIndex = { [method: string]: { [url: string]: Resource } }
export type ResourceGroup = { [group: string]: Resource[] }

export type ResourceFilterCallback = (tag: ResourceTag, res: Resource) => boolean

export class Spec {
  private resources: Resource[] = []
  resourceTree: ResourceTree = {}
  resourcesIndex: ResourcesIndex = {}
  resourcesTags: ResourceTag[] = []

  constructor(values: Partial<Spec> & { resources?: Array<Partial<Resource>> } = {}) {
    if (values.resources) this.resources = values.resources.map((r) => new Resource(r))
    this.reIndex()
  }

  toJson() {
    return JSON.stringify({
      resources: this.resources,
    })
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
    const index = (this.resourcesIndex[res.method] = this.resourcesIndex[res.method] || {})
    index[res.url] = res

    // Tree
    const byMethod = (this.resourceTree[res.method] = this.resourceTree[res.method] || {})
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
    const index = (this.resourcesIndex[method] = this.resourcesIndex[method] || {})
    return index[url]
  }

  findNearestResource(method: string, url: string) {
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
    // Return unmatch if 0: never happen
    if (searchs.length === 0) return

    // Return if the path only one.
    if (searchs.length == 1) return bySearch[searchs[0]]

    // Sort by QueryString distance.
    const theQs = QueryString.parse(u.search)
    const tupples: [string, number][] = searchs.map(qs => [qs, ProxyUrl.queryStringDistance(QueryString.parse(qs), theQs)])
    const sorted = tupples.sort((a, b) => a[1] - b[1])
    
    return bySearch[sorted[0][0]]
  }

  filterResources(cb: ResourceFilterCallback, orderAsc = true) {
    return this.resourcesTags
      .filter((tag) => cb(tag, tag.resource))
      .map((tag) => tag.resource)

      .sort((a, b) => (orderAsc ? a.timestamp - b.timestamp : b.timestamp - a.timestamp))
  }
}
