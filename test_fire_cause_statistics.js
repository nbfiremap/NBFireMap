/**
 * Test script for fire cause statistics and pie chart functionality
 * Run this in browser console after loading the main application
 */

async function testFireCauseStatistics() {
  console.log('📊 Testing Fire Cause Statistics and Pie Chart...');
  
  try {
    // Check if FireDataManager is available
    if (!window.NBFireMapFireDataManager) {
      throw new Error('FireDataManager not loaded');
    }
    
    const FireDataManager = window.NBFireMapFireDataManager;
    
    // Test fire cause statistics
    console.log('📈 Getting fire cause statistics...');
    const causeStats = await FireDataManager.getFireCauseStatistics();
    console.log('✅ Fire cause statistics:', causeStats);
    
    console.log(`📊 Results:`);
    console.log(`  - Total fires: ${causeStats.totalFires}`);
    console.log(`  - Fires with cause data: ${causeStats.totalWithCause}`);
    console.log(`  - Coverage: ${causeStats.coveragePercent.toFixed(1)}%`);
    
    console.log('🎯 Cause breakdown:');
    for (const [cause, count] of causeStats.causeStats.entries()) {
      const percentage = ((count / causeStats.totalFires) * 100).toFixed(1);
      console.log(`  - ${cause}: ${count} fires (${percentage}%)`);
    }
    
    // Test cleaning functionality on sample data
    console.log('🧹 Testing cause cleaning:');
    const testCauses = [
      'Recreation / Récréation',
      'Lightning / Foudre', 
      'Lightning (Final) / Foudre (Final)',
      'Unknown (Final) / Inconnu (Final)', 
      'Human / Humaine',
      '/',
      '',
      null,
      'Campfire'
    ];
    
    testCauses.forEach(testCause => {
      const cleaned = FireDataManager.cleanFireCause(testCause);
      console.log(`  "${testCause}" → "${cleaned}"`);
    });
    
    // Test pie chart generation (if accessible)
    if (typeof fireCausePieSegments === 'function') {
      console.log('🥧 Testing pie chart generation...');
      const pieData = fireCausePieSegments(causeStats.causeStats);
      console.log('✅ Pie chart CSS:', pieData.css.substring(0, 100) + '...');
      console.log('✅ Legend HTML generated:', pieData.legendHTML.length, 'characters');
    } else {
      console.log('⚠️ fireCausePieSegments function not accessible from console');
    }
    
    // Test summary HTML generation (if accessible)
    if (typeof buildSummaryHTML === 'function') {
      console.log('📋 Testing summary HTML generation...');
      const summaryHTML = await buildSummaryHTML();
      const hasCauseChart = summaryHTML.includes('Fire Causes (All Fires)');
      console.log(`✅ Summary HTML generated (${summaryHTML.length} chars), includes cause chart: ${hasCauseChart}`);
    } else {
      console.log('⚠️ buildSummaryHTML function not accessible from console');
    }
    
    console.log('🎉 Fire cause statistics test completed successfully!');
    
    return {
      causeStatistics: causeStats,
      testPassed: true
    };
    
  } catch (error) {
    console.error('❌ Fire cause statistics test failed:', error);
    throw error;
  }
}

// Sample function to manually test pie chart colors
function testCauseColors() {
  console.log('🎨 Testing fire cause color assignments...');
  
  const causeColors = {
    // Clean English causes (French translations and Final designations removed)
    'Recreation': '#10B981',                    // Emerald - outdoor activities
    'Resident': '#EC4899',                      // Pink - residential activities
    'Lightning': '#F59E0B',                     // Amber - natural/weather
    'Unknown': '#9CA3AF',                       // Gray - unknown
    'Other Industry': '#14B8A6',                // Teal - industrial
    'Incendiary': '#DC2626',                    // Dark Red - intentional/arson
    'Railroads': '#6B7280',                     // Cool Gray - transportation
    'Miscellaneous': '#8B5CF6',                 // Violet - miscellaneous
    'No cause data': '#D1D5DB'                  // Light Gray - no cause data available
  };
  
  console.log('🎨 Predefined cause colors:');
  for (const [cause, color] of Object.entries(causeColors)) {
    console.log(`  ${cause}: ${color}`);
  }
  
  // Test generated colors for causes not in the predefined list
  const testCauses = ['Weather', 'Mechanical', 'Electrical', 'Other'];
  console.log('🎨 Generated colors for unmapped causes:');
  testCauses.forEach(cause => {
    const generatedColor = `hsl(${(cause.charCodeAt(0) * 137) % 360}, 70%, 50%)`;
    console.log(`  ${cause}: ${generatedColor}`);
  });
}

// Auto-run message
if (typeof window !== 'undefined') {
  console.log('🚀 Fire cause statistics test script loaded. Run testFireCauseStatistics() to test.');
  console.log('🎨 Run testCauseColors() to see color assignments.');
}