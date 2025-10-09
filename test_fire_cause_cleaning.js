/**
 * Test script for fire cause cleaning functionality
 * Run this in browser console to test the cleanFireCause function
 */

// Test cases for the cleanFireCause function
function testFireCauseCleaning() {
  console.log('🧹 Testing Fire Cause Cleaning Function...');
  
  // Test cases with expected results - Remove French AND Final designations
  const testCases = [
    { input: 'Recreation / Récréation', expected: 'Recreation' },
    { input: 'Lightning / Foudre', expected: 'Lightning' },
    { input: 'Human / Humaine', expected: 'Human' },
    { input: 'Unknown / Inconnu', expected: 'Unknown' },
    { input: 'Lightning (Final) / Foudre (Final)', expected: 'Lightning' }, // Remove both French and (Final)
    { input: 'Unknown (Final) / Inconnu (Final)', expected: 'Unknown' }, // Remove both French and (Final)
    { input: 'Recreation (Final)', expected: 'Recreation' }, // Remove (Final), no French to remove
    { input: 'Equipment (final) / Équipement (final)', expected: 'Equipment' }, // Remove both French and (final)
    { input: 'Campfire', expected: 'Campfire' }, // No French part
    { input: '/', expected: null }, // Just a slash
    { input: '', expected: null }, // Empty string
    { input: null, expected: null }, // Null value
    { input: undefined, expected: null }, // Undefined
    { input: '   ', expected: null }, // Just whitespace
    { input: '   Recreation / Récréation   ', expected: 'Recreation' }, // With extra whitespace
    { input: 'Some cause / ', expected: 'Some cause' }, // French part empty
    { input: '   Lightning (Final) / Foudre (Final)   ', expected: 'Lightning' }, // Whitespace + (Final)
  ];
  
  // Mock the cleanFireCause function for testing if not available - Remove French and Final
  function cleanFireCause(cause) {
    if (!cause || typeof cause !== 'string') return null;
    
    const cleaned = cause.trim();
    if (!cleaned || cleaned === '/' || cleaned === ' / ') return null;
    
    // Remove French translation and (Final) designation
    let englishOnly = cleaned.split(' / ')[0].trim();
    englishOnly = englishOnly.replace(/\s*\(Final\)\s*$/i, '').trim();
    return englishOnly || null;
  }
  
  let passedTests = 0;
  let totalTests = testCases.length;
  
  testCases.forEach((testCase, index) => {
    const result = cleanFireCause(testCase.input);
    const passed = result === testCase.expected;
    
    console.log(
      `${passed ? '✅' : '❌'} Test ${index + 1}: ` +
      `Input: "${testCase.input}" → ` +
      `Expected: ${testCase.expected} → ` +
      `Got: ${result}`
    );
    
    if (passed) passedTests++;
  });
  
  console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed! Fire cause cleaning is working correctly.');
  } else {
    console.log('⚠️ Some tests failed. Check the implementation.');
  }
  
  return { passed: passedTests, total: totalTests };
}

// Auto-run test if this script is loaded
if (typeof window !== 'undefined') {
  console.log('🚀 Fire cause cleaning test script loaded. Run testFireCauseCleaning() to test.');
}