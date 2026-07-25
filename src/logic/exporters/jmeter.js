const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

function sampler(d) {
  const headerElems = (d.requestHeaders || []).map((h) => `            <elementProp name="" elementType="Header">
              <stringProp name="Header.name">${esc(h.name)}</stringProp>
              <stringProp name="Header.value">${esc(h.value)}</stringProp>
            </elementProp>`).join('\n');
  const headerManager = headerElems
    ? `      <hashTree>
        <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="HTTP Header Manager" enabled="true">
          <collectionProp name="HeaderManager.headers">
${headerElems}
          </collectionProp>
        </HeaderManager>
        <hashTree/>
      </hashTree>`
    : '      <hashTree/>';
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
  return `      <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${method} ${esc(d.url)}" enabled="true">
        <stringProp name="HTTPSampler.method">${method}</stringProp>
        <stringProp name="HTTPSampler.path">${esc(d.url)}</stringProp>
${bodyProp}
      </HTTPSamplerProxy>
${headerManager}`;
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
