import anyTest, { TestInterface } from 'ava'
const test = anyTest as TestInterface<{mycontext: any}>

test('test', t => {
  t.pass()
})