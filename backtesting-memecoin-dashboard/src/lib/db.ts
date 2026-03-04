import { Pool } from 'pg';

// Ghost Protocol DB Pool (port 5433)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 5000, // 5s timeout
});

// Milestone Protocol DB Pool (port 5434)
const milestonePool = new Pool({
  connectionString: process.env.MILESTONE_DATABASE_URL,
  statement_timeout: 5000,
});

// Volume Protocol DB Pool (port 5437)
const volumePool = new Pool({
  connectionString: process.env.VOLUME_DATABASE_URL,
  statement_timeout: 5000,
});

export const query = async (text: string, params?: any[]) => {
  try {
    return await pool.query(text, params);
  } catch (e) {
    console.warn(`⚠️ Ghost DB Offline: ${e}`);
    return { rows: [], rowCount: 0 };
  }
};

export const milestoneQuery = async (text: string, params?: any[]) => {
  try {
    return await milestonePool.query(text, params);
  } catch (e) {
    console.warn(`⚠️ Milestone DB Offline: ${e}`);
    return { rows: [], rowCount: 0 };
  }
};

export const volumeQuery = async (text: string, params?: any[]) => {
  try {
    return await volumePool.query(text, params);
  } catch (e) {
    console.warn(`⚠️ Early Sniper DB Error: ${e}`);
    return { rows: [], rowCount: 0 };
  }
};