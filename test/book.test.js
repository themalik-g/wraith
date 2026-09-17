import assert from 'node:assert';
import { searchBooks } from '../lib/apis.js';

async function runTests() {
  console.log('Running book search unit tests...');

  // Test 1: Search medical books (MBBS / Pharmacology)
  const res1 = await searchBooks('Pharmacology MBBS', 5);
  assert.strictEqual(res1.ok, true, 'Search should succeed for Pharmacology MBBS');
  assert.ok(res1.books.length > 0, 'Should return at least 1 book');
  console.log(`Test 1 passed: found ${res1.books.length} books for Pharmacology MBBS`);

  // Test 2: Search PharmD books
  const res2 = await searchBooks('PharmD', 5);
  assert.strictEqual(res2.ok, true, 'Search should succeed for PharmD');
  assert.ok(res2.books.length > 0, 'Should return at least 1 book for PharmD');
  console.log(`Test 2 passed: found ${res2.books.length} books for PharmD`);

  // Test 3: Search BDS / Dentist books
  const res3 = await searchBooks('Dentistry BDS', 5);
  assert.strictEqual(res3.ok, true, 'Search should succeed for Dentistry BDS');
  assert.ok(res3.books.length > 0, 'Should return at least 1 book for Dentistry BDS');
  console.log(`Test 3 passed: found ${res3.books.length} books for Dentistry BDS`);

  // Test 4: Verify book structure
  const sampleBook = res1.books[0];
  assert.ok(sampleBook.id, 'Book should have id');
  assert.ok(sampleBook.title, 'Book should have title');
  assert.ok(sampleBook.webUrl, 'Book should have webUrl');
  console.log('Test 4 passed: book object structure verified');

  console.log('All book search tests passed successfully!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
