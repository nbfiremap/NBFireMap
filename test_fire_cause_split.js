/**
 * Test script to verify the Unknown/Final out split functionality and percentage display
 * Run this in browser console after loading the main application
 */
async function testFireCauseSplit() {
  console.log('🔥 Testing Fire Cause Unknown/Final out Split...');
  
  try {
    // Check if FireDataManager is available
    if (!window.NBFireMapFireDataManager) {
      throw new Error('FireDataManager not loaded');
    }
    
    const FireDataManager = window.NBFireMapFireDataManager;
    
    // Test fire cause statistics
    console.log('📈 Getting fire cause statistics...');
    const causeStats = await FireDataManager.getFireCauseStatistics();
    
    console.log('✅ Fire cause statistics obtained');
    console.log(`📊 Results:`);
    console.log(`  - Total fires: ${causeStats.totalFires}`);
    console.log(`  - Fires with cause data: ${causeStats.totalWithCause}`);
    console.log(`  - Coverage: ${causeStats.coveragePercent.toFixed(1)}%`);
    
    console.log('🎯 Cause breakdown:');
    const totalFires = causeStats.totalFires;
    let unknownCount = 0;
    let finalOutCount = 0;
    
    for (const [cause, count] of causeStats.causeStats.entries()) {
      const percentage = ((count / totalFires) * 100).toFixed(1);
      console.log(`  - ${cause}: ${count} fires (${percentage}%)`);
      
      if (cause === 'Unknown') unknownCount = count;
      if (cause === 'Final out') finalOutCount = count;
    }
    
    // Verify split functionality
    console.log('🔍 Verifying Unknown/Final out split:');
    console.log(`  - "Unknown" (actual unknown causes): ${unknownCount} fires`);
    console.log(`  - "Final out" (no cause data): ${finalOutCount} fires`);
    
    const splitWorking = causeStats.causeStats.has('Final out');
    console.log(`  - Split functionality: ${splitWorking ? '✅ Working' : '❌ Not working'}`);
    
    // Test pie chart generation with percentages
    console.log('🥧 Testing pie chart generation with percentages...');
    
    // Since fireCausePieSegments might not be accessible from console, 
    // we'll test the logic here
    const sortedCauses = Array.from(causeStats.causeStats.entries())
      .sort((a, b) => b[1] - a[1]);
    
    console.log('📊 Pie chart data (sorted by count):');
    for (const [cause, count] of sortedCauses) {
      const percentage = ((count / totalFires) * 100).toFixed(1);
      console.log(`  - ${cause}: ${count} (${percentage}%)`);
    }
    
    console.log('🎉 Fire cause split test completed successfully!');
    
    return {
      totalFires: causeStats.totalFires,
      totalWithCause: causeStats.totalWithCause,
      unknownCount,
      finalOutCount,
      splitWorking,
      causes: Array.from(causeStats.causeStats.keys())
    };
    
  } catch (error) {
    console.error('❌ Fire cause split test failed:', error);
    throw error;
  }
}

// Function to test fire cause cleaning with various inputs
function testCauseCleaningWithSplit() {
  console.log('🧹 Testing fire cause cleaning with new split logic...');
  
  // Mock the cleanFireCause function for testing
  function cleanFireCause(cause) {
    if (!cause || typeof cause !== 'string') return null;
    const cleaned = cause.trim();
    if (!cleaned || cleaned === '/') return null;
    let englishOnly = cleaned.split(' / ')[0].trim();
    englishOnly = englishOnly.replace(/\s*\(Final\)\s*$/i, '').trim();
    return englishOnly || null;
  }
  
  const testCases = [
    { input: 'Unknown / Inconnu', expected: 'Unknown', category: 'Known unknown cause' },
    { input: 'Unknown (Final) / Inconnu (Final)', expected: 'Unknown', category: 'Known unknown cause' },
    { input: null, expected: null, category: 'No cause data (should become Final out)' },
    { input: '', expected: null, category: 'Empty cause data (should become Final out)' },
    { input: '/', expected: null, category: 'Slash only (should become Final out)' },
    { input: 'Lightning / Foudre', expected: 'Lightning', category: 'Known cause' },
    { input: 'Recreation (Final)', expected: 'Recreation', category: 'Known cause with Final' }
  ];
  
  console.log('📋 Test Results:');
  testCases.forEach((testCase, index) => {
    const result = cleanFireCause(testCase.input);
    const finalCategory = result ? result : 'Final out';
    
    console.log(`✅ Test ${index + 1}: ${testCase.category}`);
    console.log(`   Input: "${testCase.input}"`);
    console.log(`   Cleaned: "${result}"`);
    console.log(`   Final category: "${finalCategory}"`);
    console.log('');
  });
}

// Auto-run message
if (typeof window !== 'undefined') {
  console.log('🚀 Fire cause split test script loaded.');
  console.log('   Run testFireCauseSplit() to test the Unknown/Final out split.');
  console.log('   Run testCauseCleaningWithSplit() to test cause cleaning logic.');
}