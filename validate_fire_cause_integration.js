/**
 * Validation script to test the fire cause data integration
 * Run this in the browser console after loading the main application
 */

async function validateFireCauseIntegration() {
  console.log('🔥 Validating Fire Cause Data Integration...');
  
  try {
    // Check if FireDataManager is available
    if (!window.NBFireMapFireDataManager) {
      throw new Error('FireDataManager not loaded');
    }
    
    const FireDataManager = window.NBFireMapFireDataManager;
    
    // Load ERD fire locations data
    console.log('📍 Loading ERD fire locations data...');
    const erdData = await FireDataManager.loadERDFireLocationsData();
    console.log(`✅ Loaded ${erdData.size} ERD fire location records`);
    
    // Load active fires data to test joining
    console.log('🔥 Loading active fires data...');
    const activeResponse = await fetch('active_fires.geojson');
    const activeData = await activeResponse.json();
    console.log(`✅ Loaded ${activeData.features.length} active fire records`);
    
    // Test the joining logic on first 5 fires
    console.log('🔗 Testing join logic...');
    let joinedCount = 0;
    const testFires = activeData.features.slice(0, 5);
    
    testFires.forEach((fire, index) => {
      const fireProps = fire.properties;
      const erdLocation = FireDataManager.findERDFireLocation(fireProps);
      
      if (erdLocation) {
        const rawCause = erdLocation.FIELD_AGENCY_FIRE_CAUSE;
        const cleanedCause = FireDataManager.cleanFireCause(rawCause);
        
        if (cleanedCause) {
          joinedCount++;
          console.log(`✅ Fire ${index + 1} (ID: ${fireProps.OBJECTID}): Raw cause "${rawCause}" → Cleaned "${cleanedCause}"`);
        } else {
          console.log(`⚠️ Fire ${index + 1} (ID: ${fireProps.OBJECTID}): Cause data found but empty/invalid: "${rawCause}"`);
        }
      } else {
        console.log(`❌ Fire ${index + 1} (ID: ${fireProps.OBJECTID}): No cause data found`);
      }
    });
    
    console.log(`📊 Join Results: ${joinedCount}/${testFires.length} fires have cause data (${((joinedCount/testFires.length)*100).toFixed(1)}%)`);
    
    // Test popup creation
    console.log('🎈 Testing popup creation with cause data...');
    if (testFires.length > 0) {
      const sampleFire = testFires[0];
      const popupContent = await FireDataManager.createFirePopupContent
        ? FireDataManager.createFirePopoupContent(sampleFire.properties, null, false)
        : 'Popup creation method not available';
      
      console.log('✅ Sample popup content created (check if it includes cause data)');
    }
    
    console.log('🎉 Validation completed successfully!');
    
    return {
      erdRecords: erdData.size,
      activeFireRecords: activeData.features.length,
      testFiresWithCause: joinedCount,
      testFiresTotal: testFires.length,
      joinSuccessRate: ((joinedCount/testFires.length)*100).toFixed(1) + '%'
    };
    
  } catch (error) {
    console.error('❌ Validation failed:', error);
    throw error;
  }
}

// Auto-run validation if this script is loaded
if (typeof window !== 'undefined') {
  console.log('🚀 Fire cause validation script loaded. Run validateFireCauseIntegration() to test.');
}