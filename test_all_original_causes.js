/**
 * Test script to verify all original FIELD_AGENCY_FIRE_CAUSE values are preserved
 * Run this in browser console after loading the main application
 */
async function testAllOriginalCauses() {
  console.log('🔥 Testing All Original Fire Cause Values...');
  
  try {
    // Check if FireDataManager is available
    if (!window.NBFireMapFireDataManager) {
      throw new Error('FireDataManager not loaded');
    }
    
    const FireDataManager = window.NBFireMapFireDataManager;
    
    // Test the cleanFireCause function with actual data values
    console.log('🧹 Testing cleanFireCause function with original values:');
    
    const originalCauses = [
      'Recreation / Récréation',           // Should become 'Recreation'
      ' / ',                               // Should become null
      'Resident / Résidents',              // Should become 'Resident'
      'Lightning (Final) / Foudre (Final)', // Should become 'Lightning' (remove French and Final)
      'Unknown (Final) / Inconnu (Final)',  // Should become 'Unknown' (remove French and Final)
      'Other Industry / Autre industrie',   // Should become 'Other Industry'
      'Incendiary (Final) / Incendiaire (Final)', // Should become 'Incendiary' (remove French and Final)
      'Railroads / Chemins de fer',        // Should become 'Railroads'
      'Miscellaneous / Divers',            // Should become 'Miscellaneous'
      null,                                // Should stay null
      '',                                  // Should stay null
      '   ',                               // Should stay null (whitespace only)
    ];
    
    originalCauses.forEach(originalCause => {
      const result = FireDataManager.cleanFireCause ? 
        FireDataManager.cleanFireCause(originalCause) : 
        'cleanFireCause function not available';
      
      console.log(`  Input: "${originalCause}" → Output: "${result}"`);
    });
    
    // Get fire cause statistics to see all values in use
    console.log('📈 Getting fire cause statistics with original values...');
    const causeStats = await FireDataManager.getFireCauseStatistics();
    
    console.log('✅ Fire cause statistics obtained');
    console.log(`📊 Results:`);
    console.log(`  - Total fires: ${causeStats.totalFires}`);
    console.log(`  - Fires with cause data: ${causeStats.totalWithCause}`);
    console.log(`  - Coverage: ${causeStats.coveragePercent.toFixed(1)}%`);
    
    console.log('🎯 All cause values in the data (with counts and percentages):');
    const totalFires = causeStats.totalFires;
    const sortedCauses = Array.from(causeStats.causeStats.entries())
      .sort((a, b) => b[1] - a[1]);
    
    for (const [cause, count] of sortedCauses) {
      const percentage = ((count / totalFires) * 100).toFixed(1);
      console.log(`  - "${cause}": ${count} fires (${percentage}%)`);
    }
    
    // Count unique cause types
    const uniqueCauses = Array.from(causeStats.causeStats.keys());
    console.log(`\n📝 Summary: Found ${uniqueCauses.length} unique cause categories`);
    
    // Verify French and Final removal by checking for specific values
    const hasExpectedValues = {
      'clean_recreation': uniqueCauses.includes('Recreation'),
      'clean_lightning': uniqueCauses.includes('Lightning'),
      'clean_unknown': uniqueCauses.includes('Unknown'),
      'clean_incendiary': uniqueCauses.includes('Incendiary'),
      'no_cause_data': uniqueCauses.includes('No cause data')
    };
    
    console.log('🔍 Verification of French and Final removal:');
    Object.entries(hasExpectedValues).forEach(([key, found]) => {
      console.log(`  ${key}: ${found ? '✅ Found' : '❌ Missing'}`);
    });
    
    const allExpectedValuesPresent = Object.values(hasExpectedValues).every(v => v);
    console.log(`\n🎉 French and Final removal: ${allExpectedValuesPresent ? '✅ SUCCESS' : '❌ FAILED'}`);
    
    return {
      totalFires: causeStats.totalFires,
      uniqueCauseCount: uniqueCauses.length,
      allCauses: uniqueCauses,
      verification: hasExpectedValues,
      success: allExpectedValuesPresent
    };
    
  } catch (error) {
    console.error('❌ Original causes test failed:', error);
    throw error;
  }
}

// Function to test pie chart colors for all original values
function testAllCauseColors() {
  console.log('🎨 Testing colors for all original fire cause values...');
  
  // This should match the causeColors object in app.js (clean English, no Final)
  const expectedCauses = [
    'Recreation',
    'Resident', 
    'Lightning',
    'Unknown',
    'Other Industry',
    'Incendiary',
    'Railroads',
    'Miscellaneous',
    'No cause data'
  ];
  
  console.log('🎨 Expected colors for clean English causes:');
  expectedCauses.forEach(cause => {
    // Generate color using the same logic as in the pie chart
    const color = cause === 'Recreation' ? '#10B981' :
                  cause === 'Resident' ? '#EC4899' :
                  cause === 'Lightning' ? '#F59E0B' :
                  cause === 'Unknown' ? '#9CA3AF' :
                  cause === 'Other Industry' ? '#14B8A6' :
                  cause === 'Incendiary' ? '#DC2626' :
                  cause === 'Railroads' ? '#6B7280' :
                  cause === 'Miscellaneous' ? '#8B5CF6' :
                  cause === 'No cause data' ? '#D1D5DB' :
                  `hsl(${(cause.charCodeAt(0) * 137) % 360}, 70%, 50%)`; // Generated color
    
    console.log(`  "${cause}": ${color}`);
  });
}

// Auto-run message
if (typeof window !== 'undefined') {
  console.log('🚀 Original fire causes test script loaded.');
  console.log('   Run testAllOriginalCauses() to test preservation of all original cause values.');
  console.log('   Run testAllCauseColors() to test color assignments for original values.');
}