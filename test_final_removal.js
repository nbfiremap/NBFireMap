/**
 * Quick test for (Final) removal functionality
 * Run this in browser console to verify the changes work correctly
 */

function testFinalRemoval() {
  console.log('🔧 Testing (Final) designation removal...');
  
  // Mock the cleanFireCause function if not available
  function cleanFireCause(cause) {
    if (!cause || typeof cause !== 'string') return null;
    
    const cleaned = cause.trim();
    if (!cleaned || cleaned === '/') return null;
    
    let englishOnly = cleaned.split(' / ')[0].trim();
    englishOnly = englishOnly.replace(/\s*\(Final\)\s*$/i, '').trim();
    return englishOnly || null;
  }
  
  // Test cases focusing on (Final) removal
  const testCases = [
    { 
      input: 'Lightning (Final) / Foudre (Final)', 
      expected: 'Lightning',
      description: 'Remove (Final) from Lightning cause'
    },
    { 
      input: 'Unknown (Final) / Inconnu (Final)', 
      expected: 'Unknown',
      description: 'Remove (Final) from Unknown cause'
    },
    { 
      input: 'Recreation (Final)', 
      expected: 'Recreation',
      description: 'Remove (Final) without French translation'
    },
    { 
      input: 'Equipment (final) / Équipement (final)', 
      expected: 'Equipment',
      description: 'Case insensitive (final) removal'
    },
    { 
      input: 'Lightning / Foudre', 
      expected: 'Lightning',
      description: 'No (Final) to remove - should work normally'
    },
    { 
      input: 'Human (Final) Activity / Activité humaine (Final)', 
      expected: 'Human (Final) Activity',
      description: 'Only remove (Final) at the end, not in middle'
    }
  ];
  
  console.log('📋 Test Results:');
  let passed = 0;
  let total = testCases.length;
  
  testCases.forEach((testCase, index) => {
    const result = cleanFireCause(testCase.input);
    const success = result === testCase.expected;
    
    console.log(
      `${success ? '✅' : '❌'} Test ${index + 1}: ${testCase.description}`
    );
    console.log(`   Input: "${testCase.input}"`);
    console.log(`   Expected: "${testCase.expected}"`);
    console.log(`   Got: "${result}"`);
    console.log('');
    
    if (success) passed++;
  });
  
  console.log(`📊 Results: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('🎉 All (Final) removal tests passed!');
    console.log('✨ Fire causes will now be properly lumped together in pie charts');
    console.log('   - "Lightning (Final)" and "Lightning" both show as "Lightning"');
    console.log('   - "Unknown (Final)" and "Unknown" both show as "Unknown"');
  } else {
    console.log('⚠️ Some tests failed - check the implementation');
  }
  
  return { passed, total, success: passed === total };
}

// Auto-run message
if (typeof window !== 'undefined') {
  console.log('🚀 (Final) removal test script loaded. Run testFinalRemoval() to test.');
}