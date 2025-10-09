/**
 * Test script to verify Unknown causes are not counted in coverage percentage
 * Run this in browser console after loading the main application
 */
async function testUnknownCauseCoverage() {
  console.log('🔍 Testing Unknown Cause Coverage Calculation...');
  
  try {
    // Check if FireDataManager is available
    if (!window.NBFireMapFireDataManager) {
      throw new Error('FireDataManager not loaded');
    }
    
    const FireDataManager = window.NBFireMapFireDataManager;
    
    // Get fire cause statistics
    console.log('📈 Getting fire cause statistics...');
    const causeStats = await FireDataManager.getFireCauseStatistics();
    
    console.log('✅ Fire cause statistics obtained');
    console.log(`📊 Results:`);
    console.log(`  - Total fires: ${causeStats.totalFires}`);
    console.log(`  - Fires with meaningful cause data: ${causeStats.totalWithCause}`);
    console.log(`  - Coverage: ${causeStats.coveragePercent.toFixed(1)}%`);
    
    // Break down the causes to show what's included/excluded from coverage
    console.log('\n🎯 Cause breakdown (showing coverage calculation):');
    const totalFires = causeStats.totalFires;
    let knownCauses = 0;
    let unknownCauses = 0;
    let noCauseData = 0;
    
    for (const [cause, count] of causeStats.causeStats.entries()) {
      const percentage = ((count / totalFires) * 100).toFixed(1);
      const includeInCoverage = !cause.toLowerCase().includes('unknown') && cause !== 'No cause data';
      
      console.log(`  - ${cause}: ${count} fires (${percentage}%) ${includeInCoverage ? '✅ COUNTS toward coverage' : '❌ Does NOT count toward coverage'}`);
      
      if (includeInCoverage) {
        knownCauses += count;
      } else if (cause.toLowerCase().includes('unknown')) {
        unknownCauses += count;
      } else if (cause === 'No cause data') {
        noCauseData += count;
      }
    }
    
    // Verify calculation
    console.log('\n🧮 Coverage calculation verification:');
    console.log(`  - Fires with meaningful causes: ${knownCauses}`);
    console.log(`  - Fires with "Unknown" causes: ${unknownCauses} (not counted)`);
    console.log(`  - Fires with no cause data: ${noCauseData} (not counted)`);
    console.log(`  - Total excluded from coverage: ${unknownCauses + noCauseData}`);
    console.log(`  - Expected coverage: ${knownCauses}/${totalFires} = ${((knownCauses / totalFires) * 100).toFixed(1)}%`);
    console.log(`  - Actual coverage: ${causeStats.coveragePercent.toFixed(1)}%`);
    
    const calculationCorrect = Math.abs(causeStats.coveragePercent - ((knownCauses / totalFires) * 100)) < 0.1;
    console.log(`  - Calculation matches: ${calculationCorrect ? '✅ YES' : '❌ NO'}`);
    
    console.log('\n📝 Summary:');
    console.log(`  - Unknown causes are now excluded from meaningful cause data`);
    console.log(`  - Coverage percentage represents truly identifiable causes only`);
    console.log(`  - This gives a more accurate picture of investigation completeness`);
    
    return {
      totalFires: causeStats.totalFires,
      meaningfulCauses: knownCauses,
      unknownCauses: unknownCauses,
      noCauseData: noCauseData,
      coveragePercent: causeStats.coveragePercent,
      calculationCorrect
    };
    
  } catch (error) {
    console.error('❌ Unknown cause coverage test failed:', error);
    throw error;
  }
}

// Auto-run message
if (typeof window !== 'undefined') {
  console.log('🚀 Unknown cause coverage test script loaded.');
  console.log('   Run testUnknownCauseCoverage() to test the updated coverage calculation.');
}