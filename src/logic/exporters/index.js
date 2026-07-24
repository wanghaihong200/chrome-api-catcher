import { exportHar } from './har.js';
import { exportPostman } from './postman.js';
import { exportJmeter } from './jmeter.js';
import { exportJson } from './json.js';

export function exportAs(format, details) {
  switch (format) {
    case 'har': return exportHar(details);
    case 'postman': return exportPostman(details);
    case 'jmeter': return exportJmeter(details);
    case 'json': return exportJson(details);
    default: throw new Error(`unknown format: ${format}`);
  }
}
