
const { getMilestoneDashboardData } = require('./src/app/actions/milestone-data');

async function test() {
    process.env.MILESTONE_DATABASE_URL = "postgres://milestone_user:milestone_password@localhost:5434/milestone_db";
    console.log("🚀 Testing getMilestoneDashboardData...");
    const data = await getMilestoneDashboardData();
    console.log("📊 Data received:", JSON.stringify(data, null, 2));
}

test().catch(console.error);
