const axios = require('axios');

async function testWatsonIntegration() {
  try {
    console.log('🧪 Testing Watson Integration...\n');

    // Test health endpoint
    console.log('1. Testing Watson health...');
    const health = await axios.get('http://localhost:3004/health');
    console.log('✅ Watson is healthy:', health.data);

    // Test Atlas health
    console.log('\n2. Testing Atlas health...');
    const atlasHealth = await axios.get('http://localhost:3003/api/v1/health');
    console.log('✅ Atlas is healthy:', atlasHealth.data);

    console.log('\n🎉 Basic integration test successful!');
    console.log('\nWatson Orchestration Engine is running on port 3004');
    console.log('Atlas Infrastructure Agent is running on port 3003');
    console.log('\nNext steps:');
    console.log('- Create a frontend interface to interact with Watson');
    console.log('- Set up JWT authentication for secure API access');
    console.log('- Test full workflow: conversation -> intent -> workflow -> Atlas provisioning');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

testWatsonIntegration();