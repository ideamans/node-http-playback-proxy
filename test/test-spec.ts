import { Resource, ResourceTag, Spec } from "../src/spec";
import anyTest, { TestInterface } from "ava";
const test = anyTest as TestInterface<{ mycontext: any }>;

test("Resource path", (t) => {
  const get = new Resource({
    method: "GET",
    url: "https://www.example.com/path/to/file?name=value",
  });
  t.is(
    get.path,
    "get/https/www.example.com/path/to/file/index~name=value.html"
  );

  const head = new Resource({
    method: "HEAD",
    url: "https://www.example.com/path/to/file?name=value",
  });
  t.is(
    head.path,
    "head/https/www.example.com/path/to/file/index~name=value.html"
  );

  const post = new Resource({
    method: "POST",
    url: "https://www.example.com/path/to/file?name=value",
  });
  t.is(
    post.path,
    "post/https/www.example.com/path/to/file/index~name=value.html"
  );
});

test("ResourceTag extname and mimeType", (t) => {
  const res = new Resource({
    url: "https://www.example.com/path/to/file.HTML?name=value",
    headers: {
      "content-type": ["text/HTML; charset=UTF-8"],
    },
  });
  const rt = new ResourceTag(res);
  t.is(rt.extname, ".html");
  t.is(rt.mimeType, "text/html");
});

test("Resource in spec", (t) => {
  const spec = new Spec();
  const sampleUrl1 =
    "https://www.example.com/path/to/file?name1=value1&name2=value2";
  const sampleUrl2 =
    "https://www.example.com/path/to/file?name1=value1&name2=value2&name3=value3";

  t.is(spec.lookupResource("get", sampleUrl1), undefined);

  const res1 = spec.newResource({ method: "get", url: sampleUrl1 });
  t.is(spec.resourcesLength, 1);
  t.is(spec.resourcesIndex["get"][sampleUrl1].url, sampleUrl1);
  t.is(spec.lookupResource("get", sampleUrl1).url, sampleUrl1);

  t.is(spec.findNearestResource("post", sampleUrl1), undefined);
  t.is(
    spec.findNearestResource(
      "get",
      "http://www.example.com/path/to/file?name1=value1&name2=value2"
    ),
    undefined
  );
  t.is(
    spec.findNearestResource(
      "get",
      "https://example.com/path/to/file?name1=value1&name2=value2"
    ),
    undefined
  );
  t.is(
    spec.findNearestResource(
      "get",
      "https://www.example.com/path/to/unmatch?name1=value1&name2=value2"
    ),
    undefined
  );

  const nearest1 = spec.findNearestResource(
    "get",
    "https://www.example.com/path/to/file"
  );
  t.truthy(nearest1);
  if (nearest1) t.is(nearest1.url, sampleUrl1);

  const nearest2 = spec.findNearestResource(
    "get",
    "https://www.example.com/path/to/file?name1=value1&name2=value2&name3=value3"
  );
  t.truthy(nearest2);
  if (nearest2) t.is(nearest2.url, sampleUrl1);

  const res2 = spec.newResource({ method: "get", url: sampleUrl2 });
  const nearest3 = spec.findNearestResource(
    "get",
    "https://www.example.com/path/to/file?name1=value1&name2=value2&name3=value3&name4=value4"
  );
  t.truthy(nearest3);
  if (nearest3) t.is(nearest3.url, sampleUrl2);
});

test("Filter resources", (t) => {
  const spec = new Spec();
  spec.newResource({
    timestamp: 3,
    method: "get",
    url: "https://www.example.com/page1.html",
    headers: { "content-type": "text/html" },
  });
  spec.newResource({
    timestamp: 2,
    method: "get",
    url: "https://www.example.com/page2.html",
    headers: { "content-type": "text/html" },
  });
  spec.newResource({
    timestamp: 1,
    method: "get",
    url: "https://www.example.com/page2.php",
    headers: { "content-type": "text/html" },
  });
  spec.newResource({
    timestamp: 0,
    method: "get",
    url: "https://www.example.com/image.jpg",
    headers: { "content-type": "image/jpeg" },
  });

  const htmls = spec.filterResources((tag, res) => {
    return tag.extname == ".html" || tag.mimeType == "text/html";
  });

  t.is(htmls.length, 3);
  t.deepEqual(
    htmls.map((r) => r.timestamp),
    [1, 2, 3]
  );

  const jpegs = spec.filterResources((tag, res) => {
    return tag.mimeType == "image/jpeg";
  });

  t.deepEqual(
    jpegs.map((r) => r.timestamp),
    [0]
  );
});
