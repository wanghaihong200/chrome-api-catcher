const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

function sampler(d) {
  const headers = (d.requestHeaders || [])
    .map((h) => '        <Header name="' + esc(h.name) + '" value="' + esc(h.value) + '"/>').join('\n');
  let bodyProp = '';
  if (d.requestBody != null) {
    if (d.requestBodyIsBinary) {
      bodyProp = '        <!-- 请求体为二进制(base64),JMeter 不直接支持,请手动解码 -->' + '\n' +
        '        <stringProp name="Body.data">' + esc(d.requestBody) + '</stringProp>';
    } else {
      bodyProp = '        <stringProp name="Body.data">' + esc(d.requestBody) + '</stringProp>';
    }
  }
  const method = esc(d.method || 'GET');
  return '      <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="' + method + ' ' + esc(d.url) + '" enabled="true">' + '\n' +
    '        <stringProp name="HTTPSampler.method">' + method + '</stringProp>' + '\n' +
    '        <stringProp name="HTTPSampler.path">' + esc(d.url) + '</stringProp>' + '\n' +
    bodyProp + '\n' +
    '      </HTTPSamplerProxy>' + '\n' +
    '      <hashTree>' + '\n' +
    (headers || '        <!-- no headers -->') + '\n' +
    '      </hashTree>';
}

export function exportJmeter(details) {
  const samplers = (details || []).map(sampler).join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>' + '\n' +
    '<jmeterTestPlan version="1.2" properties="5.0">' + '\n' +
    '  <hashTree>' + '\n' +
    '    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="API Catcher Export" enabled="true"/>' + '\n' +
    '    <hashTree>' + '\n' +
    samplers + '\n' +
    '    </hashTree>' + '\n' +
    '  </hashTree>' + '\n' +
    '</jmeterTestPlan>';
}
