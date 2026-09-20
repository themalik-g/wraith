import { parseDisappearingDuration } from '../modules/disappearing.js';
import assert from 'node:assert';

console.log('Testing parseDisappearingDuration...');

assert.deepStrictEqual(parseDisappearingDuration('off'), { expiration: 0, label: 'OFF' });
assert.deepStrictEqual(parseDisappearingDuration('24 hours'), { expiration: 86400, label: '24 Hours' });
assert.deepStrictEqual(parseDisappearingDuration('24h'), { expiration: 86400, label: '24 Hours' });
assert.deepStrictEqual(parseDisappearingDuration('7 days'), { expiration: 604800, label: '7 Days' });
assert.deepStrictEqual(parseDisappearingDuration('7d'), { expiration: 604800, label: '7 Days' });
assert.deepStrictEqual(parseDisappearingDuration('24 days'), { expiration: 2073600, label: '24 Days' });
assert.deepStrictEqual(parseDisappearingDuration('24days'), { expiration: 2073600, label: '24 Days' });
assert.deepStrictEqual(parseDisappearingDuration('90 days'), { expiration: 7776000, label: '90 Days' });
assert.deepStrictEqual(parseDisappearingDuration('90d'), { expiration: 7776000, label: '90 Days' });
assert.strictEqual(parseDisappearingDuration('invalid_arg'), null);

console.log('All parseDisappearingDuration tests passed successfully!');
